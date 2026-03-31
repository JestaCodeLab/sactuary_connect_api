import nodemailer from 'nodemailer';

// Check if email credentials are configured
const hasEmailConfig = process.env.EMAIL_USER && process.env.EMAIL_PASSWORD;

// Email service configuration
// For Gmail, use the 'service: gmail' preset - it's more reliable than manual host/port
const emailConfig = hasEmailConfig ? {
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD, // Must be an App Password, not regular password
  },
  // Increase timeouts for cloud environments and add retry logic
  connectionTimeout: 10000, // 10 seconds (reduce from 60s for faster feedback)
  greetingTimeout: 10000,
  socketTimeout: 10000,
  maxConnections: 5,
  maxMessages: 100,
  pool: true,
  secure: true, // Use TLS
  requireTLS: true,
} : {
  // Fallback to console logging if no email config
  streamTransport: true,
  newline: 'unix',
  buffer: true,
};

// Create transporter
const transporter = nodemailer.createTransport(emailConfig);

// Track connection status
let isEmailServiceReady = false;
let emailServiceError = null;

// Verify connection only if using real SMTP
if (hasEmailConfig) {
  console.log('📧 Attempting to connect to Gmail SMTP...');
  console.log(`   User: ${process.env.EMAIL_USER}`);
  console.log(`   Password: ${process.env.EMAIL_PASSWORD ? '***' + process.env.EMAIL_PASSWORD.slice(-4) : 'NOT SET'}`);

  transporter.verify((error, success) => {
    if (error) {
      isEmailServiceReady = false;
      emailServiceError = error.message;
      console.error('⚠️  Email service warning:', error.message);
      console.error('⚠️  Full error:', error);
      console.warn('⚠️  Emails will be logged to console instead of being sent');
      console.warn('⚠️  Make sure you are using a Gmail App Password (not your regular password)');
      console.warn('⚠️  Generate one at: https://myaccount.google.com/apppasswords');
      console.warn('⚠️  Troubleshooting:');
      console.warn('     - Check EMAIL_USER and EMAIL_PASSWORD are correct');
      console.warn('     - Ensure 2-Step Verification is enabled on Gmail account');
      console.warn('     - Use an App Password, not your regular password');
      console.warn('     - If on a cloud platform, Gmail SMTP might be blocked');
      console.warn('     - Check firewall/network settings for port 465 (TLS)');
    } else {
      isEmailServiceReady = true;
      console.log('✓ Email service ready - connected to Gmail SMTP');
    }
  });

  // Retry verification after 5 seconds if first attempt failed
  setTimeout(() => {
    if (!isEmailServiceReady && hasEmailConfig) {
      console.log('📧 Retrying Gmail SMTP connection...');
      transporter.verify((error, success) => {
        if (error) {
          console.error('⚠️  Retry failed:', error.message);
        } else {
          isEmailServiceReady = true;
          console.log('✓ Email service connected on retry');
        }
      });
    }
  }, 5000);
} else {
  console.warn('⚠️  No email credentials configured - emails will be logged to console');
  console.warn('⚠️  Set EMAIL_USER and EMAIL_PASSWORD environment variables to enable email sending');
}

export default transporter;
export { hasEmailConfig, isEmailServiceReady };

