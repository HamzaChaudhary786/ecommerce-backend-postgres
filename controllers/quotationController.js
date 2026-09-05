import prisma from "../config/db.js";
import crypto from "crypto";
import { AppError, generateOrderNumber } from "../utils/helpers.js";
import { getIo } from "../socket.js";

// Seller: Create a Quotation from an Inquiry
export const createQuotation = async (req, res, next) => {
    try {
        const sellerId = req.user.id;
        const { inquiryId, quotedPrice, quotedQuantity, message, validUntil } = req.body;

        if (!inquiryId || !quotedPrice || !quotedQuantity) {
            return next(new AppError("Inquiry ID, quoted price, and quoted quantity are required.", 400));
        }

        // Verify inquiry belongs to this seller
        const inquiry = await prisma.b2BInquiry.findUnique({
            where: { id: inquiryId }
        });

        if (!inquiry) {
            return next(new AppError("Inquiry not found.", 404));
        }

        if (inquiry.sellerId !== sellerId) {
            return next(new AppError("You can only quote on inquiries for your own listings.", 403));
        }

        const quotation = await prisma.quotation.create({
            data: {
                id: crypto.randomUUID(),
                inquiryId,
                sellerId,
                buyerId: inquiry.buyerId,
                listingId: inquiry.listingId,
                quotedPrice: parseFloat(quotedPrice),
                quotedQuantity: parseInt(quotedQuantity, 10),
                message,
                validUntil: validUntil ? new Date(validUntil) : null,
                status: "SENT",
                updatedAt: new Date()
            }
        });

        // Optionally update inquiry status to RESPONDED
        if (inquiry.status === "PENDING") {
            await prisma.b2BInquiry.update({
                where: { id: inquiryId },
                data: { status: "RESPONDED", updatedAt: new Date() }
            });
        }

        // Notify the buyer
        const notification = await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined, 
                userId: inquiry.buyerId,
                targetRole: "buyer",
                type: "quotation",
                title: "New Formal Quote Received",
                message: `Seller has responded with a formal quote for your inquiry.`,
                link: "/buyer/quotations"
            }
        });

        const io = getIo();
        if (io) {
            io.to(`user:${inquiry.buyerId}`).emit("newNotification", notification);
        }

        res.status(201).json({
            status: "success",
            data: { quotation }
        });
    } catch (error) {
        next(error);
    }
};

// Seller: Get all sent quotations
export const getSellerQuotations = async (req, res, next) => {
    try {
        const sellerId = req.user.id;

        const quotations = await prisma.quotation.findMany({
            where: { sellerId },
            include: {
                Listing: { select: { title: true, images: true } },
                User_Quotation_buyerIdToUser: { select: { name: true, email: true } },
                B2BInquiry: true
            },
            orderBy: { createdAt: 'desc' }
        });

        res.status(200).json({
            status: "success",
            results: quotations.length,
            data: { quotations }
        });
    } catch (error) {
        next(error);
    }
};

// Buyer: Get all received quotations
export const getBuyerQuotations = async (req, res, next) => {
    try {
        const buyerId = req.user.id;

        const quotations = await prisma.quotation.findMany({
            where: { buyerId },
            include: {
                Listing: { select: { id: true, title: true, images: true } },
                User_Quotation_sellerIdToUser: { select: { id: true, name: true, email: true, store: { select: { storeName: true } } } },
                B2BInquiry: true
            },
            orderBy: { createdAt: 'desc' }
        });

        res.status(200).json({
            status: "success",
            results: quotations.length,
            data: { quotations }
        });
    } catch (error) {
        next(error);
    }
};

// Buyer: Update quotation status (ACCEPT or REJECT)
export const updateQuotationStatus = async (req, res, next) => {
    try {
        const buyerId = req.user.id;
        const { id } = req.params;
        const { status } = req.body;

        if (!["ACCEPTED", "REJECTED"].includes(status)) {
            return next(new AppError("Status must be ACCEPTED or REJECTED", 400));
        }

        const quotation = await prisma.quotation.findUnique({
            where: { id },
            include: { Listing: true }
        });

        if (!quotation) return next(new AppError("Quotation not found", 404));
        if (quotation.buyerId !== buyerId) return next(new AppError("Unauthorized", 403));
        if (quotation.status !== "SENT") return next(new AppError(`Quotation is already ${quotation.status}`, 400));

        let updatedQuotation;

        // Use a transaction if accepting, to also create the Order safely
        if (status === "ACCEPTED") {
            const totalAmount = quotation.quotedPrice * quotation.quotedQuantity;

            const transactionResult = await prisma.$transaction(async (prismaClient) => {
                const orderNumber = generateOrderNumber();
                const order = await prismaClient.order.create({
                    data: {
                        orderNumber,
                        orderSource: "REQUEST_BULK_QUOTE",
                        buyerId: quotation.buyerId,
                        status: "payment_pending",
                        paymentStatus: "pending",
                        subtotal: totalAmount,
                        total: totalAmount,
                        shippingAddress: {},
                        billingAddress: {}
                    }
                });

                const updatedQ = await prismaClient.quotation.update({
                    where: { id },
                    data: { status: "ACCEPTED", updatedAt: new Date(), orderId: order.id }
                });

                await prismaClient.orderItem.create({
                    data: {
                        orderId: order.id,
                        listingId: quotation.listingId,
                        sellerId: quotation.sellerId,
                        title: `Bulk Quote: ${quotation.Listing?.title || 'Product'}`,
                        image: quotation.Listing?.images?.[0]?.url || quotation.Listing?.images?.[0] || null,
                        price: quotation.quotedPrice,
                        quantity: quotation.quotedQuantity,
                        subtotal: totalAmount,
                        itemStatus: "pending"
                    }
                });

                // Optionally close inquiry
                await prismaClient.b2BInquiry.update({
                    where: { id: quotation.inquiryId },
                    data: { status: "CLOSED", updatedAt: new Date() }
                });

                return { updatedQ, order };
            });

            return res.status(200).json({
                status: "success",
                data: {
                    quotation: transactionResult.updatedQ,
                    order: transactionResult.order
                }
            });
        } else {
            // REJECTED flow
            updatedQuotation = await prisma.quotation.update({
                where: { id },
                data: { status: "REJECTED", updatedAt: new Date() }
            });
            
            // Optionally close inquiry
            await prisma.b2BInquiry.update({
                where: { id: quotation.inquiryId },
                data: { status: "CLOSED", updatedAt: new Date() }
            });

            return res.status(200).json({
                status: "success",
                data: { quotation: updatedQuotation }
            });
        }

    } catch (error) {
        next(error);
    }
};
