import transporter, { hasEmailConfig, isEmailServiceReady } from '../config/email.js';
import { emailTemplates } from '../services/emailService.js';

/**
 * Send email with retry logic
 */
const sendEmailWithRetry = async (mailOptions, maxRetries = 2) => {
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const info = await transporter.sendMail(mailOptions);
      return { success: true, info };
    } catch (error) {
      lastError = error;
      console.warn(`⚠️  Email send attempt ${attempt}/${maxRetries} failed:`, error.message);
      
      // If it's a timeout, retry; otherwise give up
      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
        if (attempt < maxRetries) {
          console.log(`   Retrying in 2 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
      }
      
      // Non-retriable error or last attempt failed
      return { success: false, error };
    }
  }

  return { success: false, error: lastError };
};

/**
 * Send verification email with code
 */
export const sendVerificationEmail = async (email, firstName, verificationCode) => {
  try {
    if (!hasEmailConfig) {
      console.warn('⚠️  EMAIL not configured. Verification code:', verificationCode);
      console.warn(`⚠️  To enable emails, set EMAIL_USER and EMAIL_PASSWORD in Railway`);
      return true; // Don't fail registration
    }

    const { subject, html, text } = emailTemplates.verification(firstName, verificationCode);

    const result = await sendEmailWithRetry({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject,
      html,
      text,
    }, 2);

    if (!result.success) {
      console.error('❌ Error sending verification email:', result.error?.message);
      console.error('   Verification code (use this for testing):', verificationCode);
      // Don't throw - registration should still succeed
      return false;
    }

    if (result.info?.rejected && result.info.rejected.length > 0) {
      console.warn('⚠️  Email rejected:', result.info.rejected);
      return false;
    }

    console.log('✓ Verification email sent to:', email);
    return true;
  } catch (error) {
    console.error('❌ Unexpected error in sendVerificationEmail:', error.message);
    console.error('   Verification code (use this for testing):', verificationCode);
    return false;
  }
};

/**
 * Send password reset email
 */
export const sendPasswordResetEmail = async (email, firstName, resetToken) => {
  try {
    if (!hasEmailConfig) {
      console.warn('⚠️  EMAIL not configured. Password reset token logged.');
      console.warn(`⚠️  Reset token for ${email}:`, resetToken);
      return true;
    }

    const resetLink = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;
    const { subject, html, text } = emailTemplates.passwordReset(firstName, resetLink);

    const result = await sendEmailWithRetry({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject,
      html,
      text,
    }, 2);

    if (!result.success) {
      console.error('❌ Error sending password reset email:', result.error?.message);
      console.error('   Reset token (use this for testing):', resetToken);
      return false;
    }

    if (result.info?.rejected && result.info.rejected.length > 0) {
      console.warn('⚠️  Email rejected:', result.info.rejected);
      return false;
    }

    console.log('✓ Password reset email sent to:', email);
    return true;
  } catch (error) {
    console.error('❌ Unexpected error in sendPasswordResetEmail:', error.message);
    console.error('   Reset token (use this for testing):', resetToken);
    return false;
  }
};

/**
 * Send welcome email
 */
export const sendWelcomeEmail = async (email, churchName) => {
  try {
    if (!hasEmailConfig) {
      console.warn('⚠️  EMAIL not configured. Welcome email not sent.');
      return true;
    }

    const { subject, html, text } = emailTemplates.welcome(churchName);

    const result = await sendEmailWithRetry({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject,
      html,
      text,
    }, 2);

    if (!result.success) {
      console.error('❌ Error sending welcome email:', result.error?.message);
      return false;
    }

    if (result.info?.rejected && result.info.rejected.length > 0) {
      console.warn('⚠️  Email rejected:', result.info.rejected);
      return false;
    }

    console.log('✓ Welcome email sent to:', email);
    return true;
  } catch (error) {
    console.error('❌ Unexpected error in sendWelcomeEmail:', error.message);
    return false;
  }
};
