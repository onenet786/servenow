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

/**
 * Send welcome email to new user
 * @param {string} email 
 * @param {string} name 
 */
async function sendWelcomeEmail(email, name) {
    const subject = 'Welcome to ServeNow!';
    const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <div style="text-align: center; margin-bottom: 30px;">
                <h1 style="color: #4CAF50;">Welcome to ServeNow!</h1>
            </div>
            <p>Hi ${name},</p>
            <p>Thank you for joining ServeNow! We're excited to have you on board.</p>
            <p>With ServeNow, you can get fresh groceries and household items delivered to your doorstep from your favorite local stores.</p>
            <div style="margin-top: 30px; padding: 20px; background-color: #f9f9f9; border-radius: 5px;">
                <h3 style="margin-top: 0;">What's next?</h3>
                <ul>
                    <li>Browse local stores</li>
                    <li>Add items to your cart</li>
                    <li>Enjoy fast delivery!</li>
                </ul>
            </div>
            <p>If you have any questions, feel free to reply to this email.</p>
            <p>Happy shopping!</p>
            <p>Best regards,<br>The ServeNow Team</p>
        </div>
    `;

    return sendMail(email, subject, html);
}

/**
 * Send order confirmation email
 * @param {string} email 
 * @param {Object} order 
 */
async function sendOrderConfirmationEmail(email, order) {
    const subject = `Order Confirmation - ${order.order_number}`;
    const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <div style="text-align: center; margin-bottom: 30px;">
                <h1 style="color: #4CAF50;">Order Confirmed!</h1>
                <p>Thank you for your order.</p>
            </div>
            <div style="background-color: #f9f9f9; padding: 20px; border-radius: 5px; margin-bottom: 20px;">
                <h3 style="margin-top: 0; border-bottom: 1px solid #ddd; padding-bottom: 10px;">Order Summary</h3>
                <p><strong>Order Number:</strong> ${order.order_number}</p>
                <p><strong>Total Amount:</strong> PKR ${parseFloat(order.total_amount).toFixed(2)}</p>
                <p><strong>Delivery Address:</strong> ${order.delivery_address}</p>
                <p><strong>Payment Method:</strong> ${order.payment_method}</p>
            </div>
            <p>We'll notify you when your order is out for delivery.</p>
            <p>Best regards,<br>The ServeNow Team</p>
        </div>
    `;

    return sendMail(email, subject, html);
}

/**
 * Send delivery confirmation email
 * @param {string} email 
 * @param {Object} order 
 */
async function sendDeliveryConfirmationEmail(email, order) {
    const subject = `Your Order Has Been Delivered! - ${order.order_number}`;
    const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <div style="text-align: center; margin-bottom: 30px;">
                <h1 style="color: #4CAF50;">Order Delivered!</h1>
                <p>Your order #${order.order_number} has been successfully delivered.</p>
            </div>
            <div style="background-color: #f9f9f9; padding: 20px; border-radius: 5px; margin-bottom: 20px;">
                <h3>Order Details</h3>
                <p><strong>Order Number:</strong> ${order.order_number}</p>
                <p><strong>Delivery Address:</strong> ${order.delivery_address}</p>
            </div>
            <p>We hope you enjoy your purchase! If you have any feedback, please let us know.</p>
            <p>Thank you for choosing ServeNow!</p>
            <p>Best regards,<br>The ServeNow Team</p>
        </div>
    `;

    return sendMail(email, subject, html);
}

/**
 * Generic mail sender
 * @param {string} to 
 * @param {string} subject 
 * @param {string} html 
 */
async function sendMail(to, subject, html) {
    if (transporter) {
        try {
            await transporter.sendMail({
                from: `"ServeNow" <${process.env.EMAIL_USER}>`,
                to: to,
                subject: subject,
                html: html
            });
            console.log(`Email sent to ${to}: ${subject}`);
            return true;
        } catch (error) {
            console.error('Error sending email:', error);
            return false;
        }
    } else {
        console.log('----------------------------------------');
        console.log(`[MOCK EMAIL] To: ${to}`);
        console.log(`[MOCK EMAIL] Subject: ${subject}`);
        console.log('----------------------------------------');
        return true;
    }
}

module.exports = {
    sendVerificationEmail,
    sendWelcomeEmail,
    sendOrderConfirmationEmail,
    sendDeliveryConfirmationEmail
};
