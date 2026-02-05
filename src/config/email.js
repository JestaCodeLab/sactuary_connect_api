import nodemailer from 'nodemailer';

// Email service configuration
const emailConfig = {
  // Using Gmail SMTP (you can change to your email provider)
  service: process.env.EMAIL_SERVICE || 'gmail',
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT || 587,
  secure: process.env.EMAIL_SECURE === 'true', // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD, // For Gmail, use App Password instead of regular password
  },
};

// Create transporter
const transporter = nodemailer.createTransport(emailConfig);

// Verify connection
transporter.verify((error, success) => {
  if (error) {
    console.warn('Email service warning:', error.message);
  } else {
    console.log('✓ Email service ready');
  }
});

export default transporter;
