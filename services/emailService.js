const nodemailer = require('nodemailer');

// Text typed on a public form must not become part of the email's HTML.
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Create transporter only if credentials exist
let transporter = null;

if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    transporter = nodemailer.createTransport({
        service: 'gmail', // Or use generic SMTP
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });
}

/**
 * Send verification code to email
 * @param {string} email 
 * @param {string} code 
 */
async function sendVerificationEmail(email, code) {
    const subject = 'Your Verification Code - ServeNow';
    const text = `Your verification code is: ${code}. It will expire in 10 minutes.`;
    const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Welcome to ServeNow!</h2>
            <p>Please use the following code to verify your email address:</p>
            <h1 style="color: #4CAF50; letter-spacing: 5px;">${code}</h1>
            <p>This code will expire in 10 minutes.</p>
            <p>If you didn't request this, please ignore this email.</p>
        </div>
    `;

    if (transporter) {
        try {
            await transporter.sendMail({
                from: `"ServeNow" <${process.env.EMAIL_USER}>`,
                to: email,
                subject: subject,
                text: text,
                html: html
            });
            console.log(`Verification email sent to ${email}`);
            return true;
        } catch (error) {
            console.error('Error sending email:', error);
            // Fallback to console log in dev
            console.log('----------------------------------------');
            console.log(`To: ${email}`);
            console.log(`Code: ${code}`);
            console.log('----------------------------------------');
            return false;
        }
    } else {
        console.warn('Email credentials not found. Logging code to console.');
        console.log('----------------------------------------');
        console.log(`[MOCK EMAIL] To: ${email}`);
        console.log(`[MOCK EMAIL] Code: ${code}`);
        console.log('----------------------------------------');
        return true; // Pretend it worked
    }
}

/**
 * Send account deletion request email to support
 * @param {string} userEmail 
 * @param {string} reason 
 */
async function sendDeletionRequestEmail(userEmail, reason) {
    const supportEmail = 'onenetpk@gmail.com'; // User specified email
    const subject = 'Account Deletion Request - ServeNow';
    const text = `A new account deletion request has been received.\n\nUser Email: ${userEmail}\nReason: ${reason || 'Not provided'}`;
    const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Account Deletion Request</h2>
            <p>A new account deletion request has been received from the web form.</p>
            <p><strong>User Email:</strong> ${escapeHtml(userEmail)}</p>
            <p><strong>Reason:</strong> ${escapeHtml(reason || 'Not provided')}</p>
            <p>Please process this request within 48-72 hours.</p>
        </div>
    `;

    if (transporter) {
        try {
            await transporter.sendMail({
                from: `"ServeNow System" <${process.env.EMAIL_USER}>`,
                to: supportEmail,
                subject: subject,
                text: text,
                html: html
            });
            console.log(`Deletion request email sent to support for ${userEmail}`);
            return true;
        } catch (error) {
            console.error('Error sending deletion request email:', error);
            return false;
        }
    } else {
        console.warn('Email credentials not found. Logging deletion request to console.');
        console.log('----------------------------------------');
        console.log(`[MOCK EMAIL] To: ${supportEmail}`);
        console.log(`[MOCK EMAIL] Request from: ${userEmail}`);
        console.log(`[MOCK EMAIL] Reason: ${reason}`);
        console.log('----------------------------------------');
        return true;
    }
}

/**
 * Send order completion "Thanks" email to user
 * @param {string} email 
 * @param {string} userName 
 * @param {string} orderNumber 
 */
async function sendOrderThanksEmail(email, userName, orderNumber) {
    const subject = `Thank You for Your Order! - ${orderNumber}`;
    const text = `Hi ${userName},\n\nThank you for choosing ServeNow! Your order ${orderNumber} has been successfully delivered and payment received. We hope you enjoyed our service.\n\nBest regards,\nThe ServeNow Team`;
    const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <div style="text-align: center; margin-bottom: 30px;">
                <h2 style="color: #4CAF50;">Thank You for Your Order!</h2>
                <p style="font-size: 16px;">Hi ${userName},</p>
            </div>
            <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px;">
                <p>We are happy to inform you that your order <strong>${orderNumber}</strong> has been completed successfully.</p>
                <p>Our rider has delivered your items and payment has been processed.</p>
                <p>We hope you are satisfied with the quality of our service and products. If you have any feedback, please feel free to reach out to us.</p>
            </div>
            <div style="margin-top: 30px; text-align: center; color: #777; font-size: 14px;">
                <p>Best regards,</p>
                <p><strong>The ServeNow Team</strong></p>
            </div>
        </div>
    `;

    if (transporter) {
        try {
            await transporter.sendMail({
                from: `"ServeNow" <${process.env.EMAIL_USER}>`,
                to: email,
                subject: subject,
                text: text,
                html: html
            });
            console.log(`Thanks email sent to ${email} for order ${orderNumber}`);
            return true;
        } catch (error) {
            console.error('Error sending thanks email:', error);
            return false;
        }
    } else {
        console.warn('Email credentials not found. Logging thanks email to console.');
        console.log('----------------------------------------');
        console.log(`[MOCK EMAIL] To: ${email}`);
        console.log(`[MOCK EMAIL] Message: Thank you ${userName} for order ${orderNumber}`);
        console.log('----------------------------------------');
        return true;
    }
}

/**
 * Send password reset OTP
 * @param {string} email 
 * @param {string} otp 
 */
async function sendPasswordResetOTP(email, otp) {
    const subject = 'Your Password Reset OTP - ServeNow';
    const text = `Your password reset OTP is: ${otp}. It will expire in 10 minutes.`;
    const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Password Reset Request</h2>
            <p>Please use the following OTP to reset your password:</p>
            <h1 style="color: #667eea; letter-spacing: 5px;">${otp}</h1>
            <p>This code will expire in 10 minutes.</p>
            <p>If you didn't request this, please ignore this email.</p>
        </div>
    `;

    if (transporter) {
        try {
            await transporter.sendMail({
                from: `"ServeNow" <${process.env.EMAIL_USER}>`,
                to: email,
                subject: subject,
                text: text,
                html: html
            });
            console.log(`Password reset OTP sent to ${email}`);
            return true;
        } catch (error) {
            console.error('Error sending password reset OTP:', error);
            return false;
        }
    } else {
        console.warn('Email credentials not found. Logging OTP to console.');
        console.log('----------------------------------------');
        console.log(`[MOCK EMAIL] To: ${email}`);
        console.log(`[MOCK EMAIL] Reset OTP: ${otp}`);
        console.log('----------------------------------------');
        return true;
    }
}

module.exports = {
    sendVerificationEmail,
    sendDeletionRequestEmail,
    sendOrderThanksEmail,
    sendPasswordResetOTP
};
