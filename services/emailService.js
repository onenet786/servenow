const nodemailer = require('nodemailer');

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

module.exports = {
    sendVerificationEmail
};
