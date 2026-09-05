import nodemailer from "nodemailer";
import prisma from "../config/db.js";

/**
 * Helper to check if SMTP is configured with real credentials (not placeholders)
 */
export const isSmtpConfigured = () => {
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASS;
    const placeholders = [
        "your_gmail@gmail.com",
        "your_gmail_app_password",
        "your_gmail_app_password_here"
    ];

    if (!user || !pass) return false;
    if (placeholders.includes(user.toLowerCase()) || placeholders.includes(pass.toLowerCase())) return false;

    return true;
};

/**
 * Configure Nodemailer Transporter
 */
const createTransporter = () => {
    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS?.replace(/\s/g, "");

    console.log("[SMTP LOG] Credentials Loading Status:");
    console.log(`[SMTP LOG] EMAIL_HOST: ${process.env.EMAIL_HOST}`);
    console.log(`[SMTP LOG] EMAIL_PORT: ${process.env.EMAIL_PORT}`);
    console.log(`[SMTP LOG] EMAIL_SECURE: ${process.env.EMAIL_SECURE}`);
    console.log(`[SMTP LOG] EMAIL_USER loaded: ${emailUser ? "YES" : "NO"}`);
    console.log(`[SMTP LOG] EMAIL_PASS loaded: ${emailPass ? `YES, length ${emailPass.length}` : "NO"}`);

    return nodemailer.createTransport({
        service: "gmail",
        host: process.env.EMAIL_HOST || "smtp.gmail.com",
        port: Number(process.env.EMAIL_PORT || 587),
        secure: process.env.EMAIL_SECURE === "true",
        auth: {
            user: emailUser,
            pass: emailPass,
        },
    });
};

/**
 * Generate a premium, Temu-style marketing email template for Deals and Flash Sales.
 */
const generateDealEmailTemplate = ({ title, originalPrice, dealPrice, discount, productUrl, image, headerTitle, sellerName, bestDeals = [], categories = [] }) => {
    const mainImage = image || "https://res.cloudinary.com/di1mttffx/image/upload/v1/listings/placeholder";
    const accentColor = "#FF3B30"; // Premium Red
    const currentYear = new Date().getFullYear();
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

    // ── Build Category Menu Links Dynamically from database ──────────────────
    let categoriesHtml = "";
    if (categories && categories.length > 0) {
        categories.forEach((cat, index) => {
            const catUrl = `${frontendUrl}/listings?category=${encodeURIComponent(cat.name)}`;
            categoriesHtml += `<a href="${catUrl}" style="color: #ffffff; text-decoration: none; margin: 0 8px; font-family: 'Inter', sans-serif; display: inline-block;">${cat.name}</a>`;
            if (index < categories.length - 1) {
                categoriesHtml += `<span style="color: #475569; margin: 0 2px;">|</span>`;
            }
        });
    } else {
        const defaultCats = ["Shoes", "Home & Kitchen", "Electronics", "Beauty & Health"];
        defaultCats.forEach((name, index) => {
            const catUrl = `${frontendUrl}/listings?category=${encodeURIComponent(name)}`;
            categoriesHtml += `<a href="${catUrl}" style="color: #ffffff; text-decoration: none; margin: 0 8px; font-family: 'Inter', sans-serif; display: inline-block;">${name}</a>`;
            if (index < defaultCats.length - 1) {
                categoriesHtml += `<span style="color: #475569; margin: 0 2px;">|</span>`;
            }
        });
    }

    // ── Build Dynamic 3-Column Best Sellers Grid ─────────────────────────────
    let gridHtml = "";
    if (bestDeals && bestDeals.length > 0) {
        gridHtml = `
        <!-- Best Sellers Section -->
        <tr>
        <!-- padding: 30px 40px 10px 40px; -->
            <td class="mobile-padding" style="padding: 30px 20px 10px 20px background-color: #ffffff;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-top: 1px solid #e2e8f0; padding-top: 30px; padding-left: 10px; padding-right: 10px;">
                    <tr>
                        <td align="center" style="padding-bottom: 25px;">
                            <h2 style="margin: 0; font-family: 'Inter', sans-serif; font-size : 22px; font-weight: 600; color: #0f172a; text-align: center; text-transform: uppercase; letter-spacing: -0.5px;">
                                🔥 Best Deals In 7 Days 🔥
                            </h2>
                            <div style="width: 50px; height: 3px; background-color: #ff9900; margin: 8px auto 0 auto; border-radius: 10px;"></div>
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
        `;

        bestDeals.slice(0, 6).forEach((deal, index) => {
            if (index > 0 && index % 3 === 0) {
                gridHtml += `</tr><tr><td height="20" colspan="5"></td></tr><tr>`;
            } else if (index > 0 && index % 3 !== 0) {
                gridHtml += `<td width="2%"></td>`;
            }

            gridHtml += `
                <td valign="top" width="15%" style="box-sizing: border-box; max-width: 150px; background-color: #ffffff; border: 1px solid #f1f5f9; border-radius: 16px; padding: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.015); text-align: left; font-family: 'Inter', sans-serif;">
                    <a href="${deal.productUrl}" style="display: block; text-decoration: none; color: inherit;">
                        <div style="position: relative; overflow: hidden; border-radius: 12px; margin-bottom: 10px; background-color: #f8fafc; height: 120px;">
                            <img src="${deal.image}" alt="${deal.title}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 12px; display: block;" border="0">
                            <div style="position: absolute; top: 6px; left: 6px; background-color: #ff9900; color: #ffffff; font-size: 9px; font-weight: 600; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.5px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                                TOP
                            </div>
                        </div>
                        <h3 style="margin: 0 0 4px 0; font-size: 13px; font-weight: 600; color: #1e293b; line-height: 1.3; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; font-family: 'Inter', sans-serif;">
                            ${deal.title}
                        </h3>
                        <div style="font-size: 11px; font-weight: 600; color: #ef4444; margin-bottom: 8px;">
                            🔥 ${deal.quantitySold || 0} sold
                        </div>
                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                            <tr>
                                <td valign="middle">
                                    <div style="font-size: 14px; font-weight: 600; color: #0f172a;">
                                        Rs.${Math.round(deal.dealPrice).toLocaleString()}
                                    </div>
                                </td>
                                <td valign="middle" align="right">
                                    <div style="display: inline-block; background-color: #000000; padding: 6px; border-radius: 50%;">
                                        <img src="https://img.icons8.com/material-outlined/24/ffffff/shopping-cart.png" width="12" height="12" style="display: block;" border="0">
                                    </div>
                                </td>
                            </tr>
                        </table>
                    </a>
                </td>
            `;
        });

        const remainder = bestDeals.slice(0, 6).length % 3;
        if (remainder > 0) {
            for (let i = remainder; i < 3; i++) {
                gridHtml += `<td width="2%"></td><td width="15%"></td>`;
            }
        }

        gridHtml += `
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
        `;
    }

    return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="x-apple-disable-message-reformatting">
    <title>${headerTitle || 'Special Offer'}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800;900&display=swap');
        html, body { margin: 0 auto !important; padding: 0 !important; height: 100% !important; width: 100% !important; background: #f4f5f7; }
        * { -ms-text-size-adjust: 100%; -webkit-text-size-adjust: 100%; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
        table, td { mso-table-lspace: 0pt !important; mso-table-rspace: 0pt !important; }
        img { -ms-interpolation-mode: bicubic; }
        a { text-decoration: none; }
        *[x-apple-data-detectors], .unstyle-auto-detected-links *, .aBn { border-bottom: 0 !important; cursor: default !important; color: inherit !important; text-decoration: none !important; font-size: inherit !important; font-family: inherit !important; font-weight: inherit !important; line-height: inherit !important; }
        @keyframes badge-pulse {
            0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
            70% { transform: scale(1.05); box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
            100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        }
        .pulse-badge {
            animation: badge-pulse 1.8s infinite ease-in-out;
            display: inline-block !important;
        }
        @media only screen and (min-device-width: 320px) and (max-device-width: 374px) { u ~ div .email-container { min-width: 320px !important; } }
        @media only screen and (min-device-width: 375px) and (max-device-width: 413px) { u ~ div .email-container { min-width: 375px !important; } }
        @media only screen and (min-device-width: 414px) { u ~ div .email-container { min-width: 414px !important; } }
        @media screen and (max-width: 600px) {
            .email-container { width: 100% !important; margin: auto !important; }
            .fluid { max-width: 100% !important; height: auto !important; margin-left: auto !important; margin-right: auto !important; }
            .stack-column, .stack-column-center { display: block !important; width: 100% !important; max-width: 100% !important; direction: ltr !important; }
            .stack-column-center { text-align: center !important; }
            .mobile-padding { padding-left: 20px !important; padding-right: 20px !important; }
            .mobile-br { display: block !important; }
        }
            @media screen and (max-width: 400px){
                .mobile-padding { padding-left: 10px !important; padding-right: 10px !important; }
            }
    </style>
</head>
<body width="100%" style="margin: 0; padding: 0 !important; mso-line-height-rule: exactly; background-color: #f4f5f7;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" bgcolor="#f4f5f7">
        <tr>
            <td  class="mobile-padding" align="center" valign="top" style="padding: 20px 10px; background-color: #f4f5f7;">
                <table class="email-container" align="center" role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="table-layout: fixed; width: 600px; max-width: 600px; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.05);">
                <!-- Header Title Banner -->
                <tr>
                    <td align="center" style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 25px 20px; text-align: center;">
                        <h1 style="margin: 0; font-family: 'Inter', sans-serif; font-size: 24px; font-weight: 600; color: #ffffff; letter-spacing: -0.5px; text-transform: uppercase;">
                            ${headerTitle || 'EXCLUSIVE DEAL'}
                        </h1>
                    </td>
                </tr>
                
                <!-- Logo & Categories (White Area) -->
                <tr>
                    <td align="center" style="background-color: #ffffff; padding: 30px 30px 10px 30px; text-align: center;">
                        <!-- Logo Box (TEMU Orange Style) -->
                        <table align="center" border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto 15px auto;">
                            <tr>
                                <td align="center" style="background: linear-gradient(135deg, #ff9900 0%, #ff5e00 100%); padding: 12px 24px; border-radius: 16px; box-shadow: 0 4px 15px rgba(255, 94, 0, 0.25);">
                                    <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                                        <tr>
                                            <td style="padding-right: 8px; vertical-align: middle;">
                                                <img src="https://img.icons8.com/ios-filled/50/ffffff/shopping-bag.png" width="22" height="22" style="display: block;" alt="Logo Icon">
                                            </td>
                                            <td style="vertical-align: middle;">
                                                <span style="font-size: 16px; font-weight: 600; color: #ffffff; letter-spacing: 1px; font-family: 'Inter', sans-serif;">SHOPVAULT</span>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                        </table>

                        <!-- Categories Menu Bar (TEMU Black Navigation Style) -->
                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #000000; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
                            <tr>
                                <td align="center" style="padding: 14px 10px; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                                    ${categoriesHtml}
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>

                <!-- Content Area -->
                <tr>
                    <td class="mobile-padding" style="padding: 10px 30px 30px 30px; background-color: #ffffff;">
                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                            <!-- Product Title & Seller Info -->
                            <tr>
                                <td style="text-align: center; padding-bottom: 6px;">
                                    <p style="margin: 0; font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 1.2px;">Sold by ${sellerName || 'Verified Partner'}</p>
                                </td>
                            </tr>
                            <tr>
                               <td style="text-align: center; padding-bottom: 20px;">
  <h2 style="
    margin: 0;
    font-size: 22px;
    font-weight: 600;
    color: #0f172a;
    line-height: 1.4;
    letter-spacing: -0.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 500px;
    display: block;
    margin-left: auto;
    margin-right: auto;
  ">
    ${title}
  </h2>
</td>
                            </tr>

                            <!-- Hero Image with Overlaid CTA Button -->
                            <tr>
                                <td align="center" style="padding-bottom: 25px;">
                                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                        <tr>
                                            <td align="center" background="${mainImage}" bgcolor="#1e293b" valign="bottom"
                                                style="background-image: url('${mainImage}'); background-size: cover; background-position: center; border-radius: 20px; height: 340px; padding: 0 20px 24px 20px; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.1); border: 1px solid #f1f5f9;">
                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="90%" style="margin: 0 auto;">
                                                    <tr>
                                                        <td align="center" style="border-radius: 100px; background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); box-shadow: 0 10px 25px rgba(79,70,229,0.5);">
                                                            <a href="${productUrl}" style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); border: 1px solid #4f46e5; font-family: 'Inter', sans-serif; font-size: 16px; line-height: 1.5; text-align: center; text-decoration: none; display: block; border-radius: 100px; font-weight: 600; text-transform: uppercase; letter-spacing: 1.5px; padding: 14px 28px; color: #ffffff;">
                                                                Claim This Deal Now <span style="font-size: 20px; vertical-align: middle; display: inline-block; margin-left: 5px;">👈</span>
                                                            </a>
                                                        </td>
                                                    </tr>
                                                </table>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>

                            <!-- Price block with Animated Badge -->
                            <tr>
                                <td>
                                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #fef2f2; border: 1px solid #fee2e2; border-radius: 20px; box-shadow: 0 4px 12px rgba(239,68,68,0.03);">
                                        <tr>
                                            <td style="padding: 24px; text-align: center;">
                                                <div class="pulse-badge" style="background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%); color: #ffffff; padding: 8px 18px; border-radius: 100px; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 15px; border: 2px solid #ffffff; box-shadow: 0 4px 15px rgba(239, 68, 68, 0.35);">
                                                    ⚡ ${discount}% OFF — LIMITED TIME ⚡
                                                </div>
                                                <div style="font-family: 'Inter', sans-serif;">
                                                    <span style="font-size: 44px; font-weight: 600; color: #ef4444; line-height: 1;">Rs.${Math.round(dealPrice).toLocaleString()}</span>
                                                    <span style="font-size: 18px; color: #94a3b8; text-decoration: line-through; margin-left: 12px; font-weight: 600;">Rs.${Math.round(originalPrice).toLocaleString()}</span>
                                                </div>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>

                <!-- Dynamic Grid Section -->
                ${gridHtml}

                <!-- Footer -->
                <tr>
                    <td style=" background-color: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;">
                        <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #475569;">ShopVault — Premium Marketplace</p>
                        <p style="margin: 0 0 16px 0; font-size: 12px; color: #94a3b8;">You received this because you're a member of ShopVault.</p>
                        <p style="margin: 0; font-size: 12px; color: #94a3b8;">&copy; ${currentYear} ShopVault. All rights reserved.</p>
                    </td>
                </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
};

/**
 * Generate a professional Email Verification template
 */
const generateVerificationEmailTemplate = (name, url) => {
    const currentYear = new Date().getFullYear();
    return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="x-apple-disable-message-reformatting">
    <title>Verify Your Email</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        html, body { margin: 0 auto !important; padding: 0 !important; height: 100% !important; width: 100% !important; background: #f4f5f7; }
        * { -ms-text-size-adjust: 100%; -webkit-text-size-adjust: 100%; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
        table, td { mso-table-lspace: 0pt !important; mso-table-rspace: 0pt !important; }
        a { text-decoration: none; }
        *[x-apple-data-detectors], .unstyle-auto-detected-links *, .aBn { border-bottom: 0 !important; cursor: default !important; color: inherit !important; text-decoration: none !important; font-size: inherit !important; font-family: inherit !important; font-weight: inherit !important; line-height: inherit !important; }
        @media screen and (max-width: 600px) {
            .email-container { width: 100% !important; margin: auto !important; }
            .mobile-padding { padding-left: 20px !important; padding-right: 20px !important; }
        }
               @media screen and (max-width: 400px) {
                .mobile-padding { padding-left: 10px !important; padding-right: 10px !important; }
               }
    </style>
</head>
<body width="100%" style="margin: 0; padding: 0 !important; mso-line-height-rule: exactly; background-color: #f4f5f7;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" bgcolor="#f4f5f7">
        <tr>
            <td class="mobile-padding" align="center" valign="top" style="padding:  20px 10px; background-color: #f4f5f7;">
                <table class="email-container" align="center" role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="table-layout: fixed; width: 600px; max-width: 600px; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.05);">
                <!-- Header -->
                <tr>
                    <td align="center" style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 40px 20px; text-align: center;">
                        <div style="display: inline-block; width: 64px; height: 64px; background-color: rgba(255,255,255,0.2); border-radius: 16px; margin-bottom: 16px; line-height: 64px; text-align: center;">
                            <img src="https://img.icons8.com/ios-filled/50/ffffff/mail.png" alt="Email" width="32" style="vertical-align: middle; padding-top: 16px;">
                        </div>
                        <h1 style="margin: 0; font-family: 'Inter', sans-serif; font-size: 28px; font-weight: 600; color: #ffffff; letter-spacing: -0.5px;">
                            ShopVault
                        </h1>
                    </td>
                </tr>
                <!-- Content -->
                <tr>
                    <td class="mobile-padding" style="padding: 40px 50px; background-color: #ffffff; text-align: center;">
                        <h2 style="margin: 0 0 16px 0; font-size: 24px; font-weight: 600; color: #0f172a; letter-spacing: -0.5px;">Verify your email address</h2>
                        <p style="margin: 0 0 32px 0; font-size: 16px; font-weight: 400; color: #475569; line-height: 1.6;">
                            Hello <strong style="color: #0f172a;">${name || 'User'}</strong>,<br><br>
                            Thank you for joining ShopVault! Please confirm your email address to activate your account and gain full access to premium deals.
                        </p>
                        
                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin: auto;">
                            <tr>
                                <td style="border-radius: 12px; background: #4f46e5; text-align: center;" class="button-td">
                                    <a href="${url}" style="background: #4f46e5; border: 1px solid #4f46e5; font-family: 'Inter', sans-serif; font-size: 16px; line-height: 1.5; text-align: center; text-decoration: none; display: block; border-radius: 12px; font-weight: 600; padding: 16px 40px; box-shadow: 0 4px 14px rgba(79,70,229,0.3);" class="button-a">
                                        <span style="color:#ffffff;" class="button-link">Verify Email Address</span>
                                    </a>
                                </td>
                            </tr>
                        </table>
                        
                        <p style="margin: 32px 0 0 0; font-size: 13px; color: #94a3b8; line-height: 1.6;">
                            If you did not create an account, no further action is required. This verification link will expire in 1 hour.
                        </p>
                    </td>
                </tr>
                <!-- Footer -->
                <tr>
                    <td style="padding: 24px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;">
                        <p style="margin: 0; font-size: 12px; color: #94a3b8;">&copy; ${currentYear} ShopVault Marketplace. All rights reserved.</p>
                    </td>
                </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
};

/**
 * Send Marketing Email to ALL registered buyers
 * @param {string} productId - listing ID (for deal) or flashSale ID (for flash_sale)
 * @param {string} campaignType - "deal" or "flash_sale"
 * @param {string[]} additionalEmails - extra emails to include (e.g. admin's email for testing)
 * @returns {{ sentCount, failedCount, total }}
 */
export const sendMarketingEmail = async (productId, campaignType, additionalEmails = []) => {
    console.log(`\n[EMAIL BLAST] ▶ Starting campaign: type=${campaignType}, productId=${productId}`);

    let productData;
    let headerTitle;
    let subjectLine;

    try {
        // ── 1. Fetch product/listing data ──────────────────────────────────────
        if (campaignType === "flash_sale") {
            const flashSale = await prisma.flashSale.findUnique({
                where: { id: productId },
                include: { listing: { include: { category: true } }, seller: true }
            });
            if (!flashSale) throw new Error("Flash sale not found");

            productData = {
                listingId: flashSale.listing.id,
                title: flashSale.listing.title,
                image: flashSale.listing.images?.[0]?.url,
                dealPrice: flashSale.flashSalePrice,
                originalPrice: flashSale.originalPrice || flashSale.listing.price,
                discount: Math.round(flashSale.discountPercentage),
                description: flashSale.listing.description,
                productUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/listings/${flashSale.listing.id}`,
                sellerName: flashSale.seller?.shopName || flashSale.seller?.username,
                categoryName: flashSale.listing.category?.name
            };
            headerTitle = (productData.categoryName || "Flash Sale").toUpperCase();
            subjectLine = `⚡ ${productData.discount}% OFF — Flash Sale on ${productData.title}`;

        } else {
            const listing = await prisma.listing.findUnique({
                where: { id: productId },
                include: { seller: true, category: true }
            });
            if (!listing) throw new Error("Deal listing not found");

            const discount = listing.dealDiscountPercent || 0;
            const dealPrice = listing.price - (listing.price * (discount / 100));

            productData = {
                listingId: listing.id,
                title: listing.title,
                image: listing.images?.[0]?.url,
                dealPrice,
                originalPrice: listing.price,
                discount: Math.round(discount),
                description: listing.description,
                productUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/listings/${listing.id}`,
                sellerName: listing.seller?.shopName || listing.seller?.username,
                categoryName: listing.category?.name
            };
            headerTitle = (productData.categoryName || "Deal of the Day").toUpperCase();
            subjectLine = `🔥 ${productData.discount}% OFF — Deal Alert: ${productData.title}`;
        }

        console.log(`[EMAIL BLAST] ✅ Product data loaded: "${productData.title}"`);

        // ── 2. Fetch all buyers from the database ─────────────────────────────
        console.log("[EMAIL BLAST] 📋 Fetching all verified buyers from database...");
        const buyers = await prisma.user.findMany({
            where: {
                role: "buyer",
                isSuspended: false,
                isVerified: true,
                email: { not: "" }
            },
            select: { email: true }
        });

        // ── 3. Build email list ───────────────────────────────────────────────
        const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        const emailSet = new Set();

        additionalEmails.forEach(e => {
            if (e && typeof e === 'string' && validateEmail(e.trim())) emailSet.add(e.trim().toLowerCase());
        });

        buyers.forEach(b => {
            if (b.email && typeof b.email === 'string' && validateEmail(b.email.trim())) emailSet.add(b.email.trim().toLowerCase());
        });

        const allEmails = Array.from(emailSet);
        if (allEmails.length === 0) {
            console.warn("[EMAIL BLAST] ⚠ No valid buyer emails found.");
            return { sentCount: 0, failedCount: 0, total: 0, failedEmails: [] };
        }

        console.log(`[EMAIL BLAST] 📧 Preparing to send to ${allEmails.length} unique emails.`);

        // ── 4. Generate HTML template with dynamic best deals grid ────────────
        const otherListings = await prisma.listing.findMany({
            where: {
                status: "active",
                id: { not: productData.listingId }
            },
            orderBy: { createdAt: "desc" },
            take: 6,
            include: { seller: true }
        });

        const bestDeals = otherListings.map(listing => {
            const discount = listing.dealDiscountPercent || Math.floor(Math.random() * 30) + 15;
            const dealPrice = listing.price - (listing.price * (discount / 100));
            return {
                id: listing.id,
                title: listing.title,
                image: listing.images?.[0]?.url || "https://res.cloudinary.com/di1mttffx/image/upload/v1/listings/placeholder",
                originalPrice: listing.price,
                dealPrice,
                discount: Math.round(discount),
                productUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/listings/${listing.id}`,
                quantitySold: listing.quantitySold || 0
            };
        });

        const dbCategories = await prisma.category.findMany({
            take: 4,
            select: { name: true }
        });

        const htmlTemplate = generateDealEmailTemplate({ ...productData, headerTitle, bestDeals, categories: dbCategories });

        // ── 5. Validate email credentials ─────────────────────────────────────
        if (!isSmtpConfigured()) {
            console.warn("[EMAIL BLAST] ⚠ SMTP credentials are not configured correctly.");
            return { sentCount: 0, failedCount: 0, total: allEmails.length, smtpConfigured: false };
        }

        const transporter = createTransporter();

        // ── 5b. Verify Transporter Connection ─────────────────────────────────
        console.log("[EMAIL BLAST] 📡 Verifying SMTP connection...");
        try {
            await transporter.verify();
            console.log("[EMAIL BLAST] ✅ SMTP server is ready to take our messages.");
        } catch (verifyErr) {
            console.error("[EMAIL BLAST] ❌ SMTP Verification Failed!");
            console.error(`[EMAIL BLAST] Code: ${verifyErr.code}`);
            console.error(`[EMAIL BLAST] Message: ${verifyErr.message}`);

            if (verifyErr.code === 'EAUTH' || verifyErr.responseCode === 535) {
                const authError = "SMTP authentication failed. Please generate a new Gmail App Password for the same admin Gmail.";
                console.error(`[EMAIL BLAST] 💡 ${authError}`);
                return { sentCount: 0, failedCount: 0, total: allEmails.length, error: authError };
            }
            throw verifyErr;
        }

        const BATCH_SIZE = 10;
        let sentCount = 0;
        let failedCount = 0;
        const failedEmails = [];

        // ── 6. Send emails in safe batches ────────────────────────────────────
        for (let i = 0; i < allEmails.length; i += BATCH_SIZE) {
            const batch = allEmails.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async (email) => {
                try {
                    await transporter.sendMail({
                        from: `"ShopVault Deals" <${process.env.EMAIL_USER}>`,
                        to: email,
                        subject: subjectLine,
                        html: htmlTemplate,
                        headers: {
                            'List-Unsubscribe': `<mailto:${process.env.EMAIL_USER}?subject=unsubscribe>`,
                            'X-Campaign-ID': productId,
                            'X-Entity-Ref-ID': Date.now()
                        }
                    });
                    sentCount++;
                } catch (err) {
                    failedCount++;
                    failedEmails.push(email);
                    console.error(`[EMAIL BLAST] ❌ Failed to send to ${email}: ${err.message}`);
                }
            }));
            if (i + BATCH_SIZE < allEmails.length) await new Promise(r => setTimeout(r, 500));
        }

        // ── 7. Update emailStatus on product ──────────────────────────────────
        try {
            const updateObj = { data: { emailStatus: "sent", emailSentAt: new Date() }, where: { id: productId } };
            if (campaignType === "flash_sale") await prisma.flashSale.update(updateObj);
            else await prisma.listing.update(updateObj);
        } catch (updateErr) {
            console.warn("[EMAIL BLAST] ⚠ Could not update emailStatus:", updateErr.message);
        }

        return { sentCount, failedCount, total: allEmails.length, failedEmails };

    } catch (err) {
        console.error("[EMAIL BLAST] 💥 Critical error:", err.message);
        throw err;
    }
};

/**
 * Send Verification Email to a single user
 */
export const sendVerificationEmail = async (email, name, token) => {
    const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email?token=${token}`;
    const htmlTemplate = generateVerificationEmailTemplate(name, verificationUrl);
    const transporter = createTransporter();

    // Verify before sending verification email too
    try {
        await transporter.verify();
    } catch (verifyErr) {
        console.error(`[EMAIL] ❌ SMTP Verification failed before sending to ${email}: ${verifyErr.message}`);
        if (verifyErr.code === 'EAUTH') {
            console.error("💡 SMTP authentication failed. Please check your App Password.");
        }
        throw verifyErr;
    }

    try {
        await transporter.sendMail({
            from: `"ShopVault" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: "Verify Your Email - ShopVault",
            html: htmlTemplate,
        });
        console.log(`[EMAIL] ✅ Verification email sent to ${email}`);
    } catch (err) {
        console.error(`[EMAIL] ❌ Failed to send verification email to ${email}:`, err.message);
        throw new Error("Failed to send verification email");
    }
};

/**
 * Send a Test Marketing Email to a single recipient
 */
export const sendTestMarketingEmail = async (productId, campaignType, targetEmail) => {
    console.log(`[EMAIL TEST] 🧪 Sending test email for #${productId} to ${targetEmail}...`);
    return await sendMarketingEmail(productId, campaignType, [targetEmail]);
};
