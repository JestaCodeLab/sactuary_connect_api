import nodemailer from 'nodemailer';

// Check if email credentials are configured
const hasEmailConfig = process.env.EMAIL_USER && process.env.EMAIL_PASSWORD;

// Email service configuration
const emailConfig = hasEmailConfig ? {
  // Using Gmail SMTP (you can change to your email provider)
  service: process.env.EMAIL_SERVICE || 'gmail',
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT || '587'),
  secure: process.env.EMAIL_SECURE === 'true', // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD, // For Gmail, use App Password instead of regular password
  },
  connectionTimeout: 10000, // 10 seconds
  greetingTimeout: 10000,
  socketTimeout: 10000,
} : {
  // Fallback to console logging if no email config
  streamTransport: true,
  newline: 'unix',
  buffer: true,
};

// Create transporter
const transporter = nodemailer.createTransport(emailConfig);

// Verify connection only if using real SMTP
if (hasEmailConfig) {
  transporter.verify((error, success) => {
    if (error) {
      console.warn('⚠️  Email service warning:', error.message);
      console.warn('⚠️  Emails will be logged to console instead of being sent');
    } else {
      console.log('✓ Email service ready');
    }
  });
} else {
  console.warn('⚠️  No email credentials configured - emails will be logged to console');
  console.warn('⚠️  Set EMAIL_USER and EMAIL_PASSWORD environment variables to enable email sending');
}

export default transporter;
export { hasEmailConfig };
