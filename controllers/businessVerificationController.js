import prisma from "../config/db.js";
import crypto from "crypto";
import { AppError } from "../utils/helpers.js";

export const submitVerification = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const userRole = req.user.role;
        const {
            companyName,
            businessRegistrationNumber,
            taxNumber,
            businessAddress,
            businessCountry,
            businessCity,
            businessPhone,
            businessWebsite,
            businessDocument,
            establishedYear,
            staffSize,
            businessType
        } = req.body;

        // Check if user has an existing verification
        let verification = await prisma.businessVerification.findUnique({
            where: { userId }
        });

        const logEntry = { action: verification ? "RESUBMITTED" : "SUBMITTED", timestamp: new Date(), by: "USER" };

        if (verification) {
            let existingLog = verification.auditLog ? (typeof verification.auditLog === 'string' ? JSON.parse(verification.auditLog) : verification.auditLog) : [];
            if (!Array.isArray(existingLog)) existingLog = [];

            // Update existing verification and set to PENDING
            verification = await prisma.businessVerification.update({
                where: { userId },
                data: {
                    companyName,
                    businessRegistrationNumber,
                    taxNumber,
                    businessAddress,
                    businessCountry,
                    businessCity,
                    businessPhone,
                    businessWebsite,
                    businessDocument,
                    establishedYear: establishedYear ? parseInt(establishedYear, 10) : null,
                    staffSize,
                    businessType,
                    verificationStatus: "PENDING",
                    auditLog: [...existingLog, logEntry],
                    submittedAt: new Date(),
                    updatedAt: new Date()
                }
            });
        } else {
            // Create new verification
            verification = await prisma.businessVerification.create({
                data: {
                    id: crypto.randomUUID(),
                    userId,
                    companyName,
                    businessRegistrationNumber,
                    taxNumber,
                    businessAddress,
                    businessCountry,
                    businessCity,
                    businessPhone,
                    businessWebsite,
                    businessDocument,
                    establishedYear: establishedYear ? parseInt(establishedYear, 10) : null,
                    staffSize,
                    businessType,
                    verificationStatus: "PENDING",
                    auditLog: [logEntry],
                    updatedAt: new Date()
                }
            });
        }

        await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined, 
                userId,
                type: "system",
                title: "Business Verification Submitted",
                message: "Your business verification request has been submitted successfully and is pending review.",
                link: userRole === "buyer" ? "/buyer/verification" : "/seller/verification"
            }
        });

        res.status(200).json({
            status: "success",
            data: {
                verification
            }
        });
    } catch (error) {
        next(error);
    }
};

// Get Current User's Verification
export const getMyVerification = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const verification = await prisma.businessVerification.findUnique({
            where: { userId }
        });

        res.status(200).json({
            status: "success",
            data: {
                verification // Can be null if not submitted
            }
        });
    } catch (error) {
        next(error);
    }
};

// Admin: Get All Verifications
export const getAllVerifications = async (req, res, next) => {
    try {
        const { status, type } = req.query;
        let filters = {};

        if (status && status !== 'all') {
            filters.verificationStatus = status;
        }

        if (type && type !== 'all') {
            filters.User = {
                businessType: type
            };
        }

        const verifications = await prisma.businessVerification.findMany({
            where: filters,
            include: {
                User: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        role: true,
                        businessType: true
                    }
                }
            },
            orderBy: { submittedAt: 'desc' }
        });

        res.status(200).json({
            status: "success",
            results: verifications.length,
            data: {
                verifications
            }
        });
    } catch (error) {
        next(error);
    }
};

// Submit or Update Verification (Seller/Buyer) s (Approve/Reject)
export const updateVerificationStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status, notes } = req.body;

        if (!["APPROVED", "REJECTED"].includes(status)) {
            return next(new AppError("Invalid status. Must be APPROVED or REJECTED", 400));
        }

        if (status === "REJECTED" && !notes) {
            return next(new AppError("Notes/reason required when rejecting verification", 400));
        }

        let existingVerification = await prisma.businessVerification.findUnique({
            where: { id },
            include: { User: { select: { id: true, role: true } } }
        });

        if (!existingVerification) {
            return next(new AppError("Verification not found", 404));
        }

        let existingLog = existingVerification.auditLog ? (typeof existingVerification.auditLog === 'string' ? JSON.parse(existingVerification.auditLog) : existingVerification.auditLog) : [];
        if (!Array.isArray(existingLog)) existingLog = [];

        const logEntry = { action: status, timestamp: new Date(), by: "ADMIN", reason: notes || null };

        const verification = await prisma.businessVerification.update({
            where: { id },
            data: {
                verificationStatus: status,
                verificationNotes: notes || null,
                auditLog: [...existingLog, logEntry],
                reviewedAt: new Date(),
                updatedAt: new Date()
            }
        });

        // If approved, update User isVerified to true to unlock B2B features
        if (status === "APPROVED") {
            await prisma.user.update({
                where: { id: existingVerification.userId },
                data: { isVerified: true }
            });
        }

        const userRole = existingVerification.User?.role === "buyer" ? "buyer" : "seller";

        await prisma.notification.create({ data: { senderId: typeof req !== "undefined" && req?.user ? req.user.id : undefined, 
                userId: existingVerification.userId,
                type: "system",
                title: status === "APPROVED" ? "Business Verification Approved" : "Business Verification Rejected",
                message: status === "APPROVED" 
                    ? "Your business verification has been approved! You now have access to verified features." 
                    : `Your verification request was rejected. Reason: ${notes}`,
                link: `/${userRole}/verification`
            }
        });

        res.status(200).json({
            status: "success",
            data: {
                verification
            }
        });
    } catch (error) {
        next(error);
    }
};
