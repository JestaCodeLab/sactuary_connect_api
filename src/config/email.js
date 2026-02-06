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
  // Increase timeouts for cloud environments
  connectionTimeout: 60000, // 60 seconds
  greetingTimeout: 60000,
  socketTimeout: 60000,
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
  console.log('📧 Attempting to connect to Gmail SMTP...');
  console.log(`   User: ${process.env.EMAIL_USER}`);
  console.log(`   Password: ${process.env.EMAIL_PASSWORD ? '***' + process.env.EMAIL_PASSWORD.slice(-4) : 'NOT SET'}`);

  transporter.verify((error, success) => {
    if (error) {
      console.error('⚠️  Email service warning:', error.message);
      console.error('⚠️  Full error:', error);
      console.warn('⚠️  Emails will be logged to console instead of being sent');
      console.warn('⚠️  Make sure you are using a Gmail App Password (not your regular password)');
      console.warn('⚠️  Generate one at: https://myaccount.google.com/apppasswords');
    } else {
      console.log('✓ Email service ready - connected to Gmail SMTP');
    }
  });
} else {
  console.warn('⚠️  No email credentials configured - emails will be logged to console');
  console.warn('⚠️  Set EMAIL_USER and EMAIL_PASSWORD environment variables to enable email sending');
}

export default transporter;
export { hasEmailConfig };
