import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

const testEmail = async () => {
    console.log("Testing SMTP Credentials...");
    console.log("USER:", process.env.EMAIL_USER);
    console.log("PASS length:", process.env.EMAIL_PASS ? process.env.EMAIL_PASS.length : 0);

    const transporter = nodemailer.createTransport({
        service: "gmail",
        host: process.env.EMAIL_HOST || "smtp.gmail.com",
        port: Number(process.env.EMAIL_PORT || 587),
        secure: process.env.EMAIL_SECURE === "true",
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS?.replace(/\s/g, ""),
        },
    });

    try {
        await transporter.verify();
        console.log("SUCCESS: SMTP Authentication passed! The credentials in .env are correct.");
    } catch (err) {
        console.error("FAILED: SMTP Authentication failed!");
        console.error(err.message);
    }
};

testEmail();
