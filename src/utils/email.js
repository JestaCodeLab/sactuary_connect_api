import transporter from '../config/email.js';
import { emailTemplates } from '../services/emailService.js';

/**
 * Send verification email with code
 */
export const sendVerificationEmail = async (email, firstName, verificationCode) => {
  try {
    if (!process.env.EMAIL_USER) {
      console.warn('⚠️  EMAIL_USER not configured. Email not sent. Code:', verificationCode);
      return true; // Don't fail registration, just warn
    }

    const { subject, html, text } = emailTemplates.verification(firstName, verificationCode);

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject,
      html,
      text,
    });

    console.log('✓ Verification email sent to:', email);
    return true;
  } catch (error) {
    console.error('Error sending verification email:', error);
    // Don't throw - registration should still succeed
    return false;
  }
};

/**
 * Send password reset email
 */
export const sendPasswordResetEmail = async (email, firstName, resetToken) => {
  try {
    if (!process.env.EMAIL_USER) {
      console.warn('⚠️  EMAIL_USER not configured. Email not sent.');
      return true;
    }

    const resetLink = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;
    const { subject, html, text } = emailTemplates.passwordReset(firstName, resetLink);

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject,
      html,
      text,
    });

    console.log('✓ Password reset email sent to:', email);
    return true;
  } catch (error) {
    console.error('Error sending password reset email:', error);
    return false;
  }
};

/**
 * Send welcome email
 */
export const sendWelcomeEmail = async (email, churchName) => {
  try {
    if (!process.env.EMAIL_USER) {
      console.warn('⚠️  EMAIL_USER not configured. Welcome email not sent.');
      return true;
    }

    const { subject, html, text } = emailTemplates.welcome(churchName);

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject,
      html,
      text,
    });

    console.log('✓ Welcome email sent to:', email);
    return true;
  } catch (error) {
    console.error('Error sending welcome email:', error);
    return false;
  }
};
