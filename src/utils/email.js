import transporter, { hasEmailConfig } from '../config/email.js';
import { emailTemplates } from '../services/emailService.js';

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

    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject,
      html,
      text,
    });

    if (info.rejected && info.rejected.length > 0) {
      console.warn('⚠️  Email rejected:', info.rejected);
      return false;
    }

    console.log('✓ Verification email sent to:', email);
    return true;
  } catch (error) {
    console.error('❌ Error sending verification email:', error.message);
    console.error('   Verification code (use this for testing):', verificationCode);
    // Don't throw - registration should still succeed
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

    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject,
      html,
      text,
    });

    if (info.rejected && info.rejected.length > 0) {
      console.warn('⚠️  Email rejected:', info.rejected);
      return false;
    }

    console.log('✓ Password reset email sent to:', email);
    return true;
  } catch (error) {
    console.error('❌ Error sending password reset email:', error.message);
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

    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject,
      html,
      text,
    });

    if (info.rejected && info.rejected.length > 0) {
      console.warn('⚠️  Email rejected:', info.rejected);
      return false;
    }

    console.log('✓ Welcome email sent to:', email);
    return true;
  } catch (error) {
    console.error('❌ Error sending welcome email:', error.message);
    return false;
  }
};
