import resend, { hasEmailConfig, EMAIL_FROM } from '../config/email.js';
import { emailTemplates } from '../services/emailService.js';

/**
 * Send email via Resend with retry logic
 */
const sendEmailWithRetry = async (mailOptions, maxRetries = 2) => {
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { data, error } = await resend.emails.send(mailOptions);
      if (error) {
        throw new Error(error.message);
      }
      return { success: true, info: data };
    } catch (error) {
      lastError = error;
      console.warn(`⚠️  Email send attempt ${attempt}/${maxRetries} failed:`, error.message);

      if (attempt < maxRetries) {
        console.log(`   Retrying in 2 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }

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
      console.warn('⚠️  To enable emails, set RESEND_API_KEY in Railway');
      return true;
    }

    const { subject, html, text } = emailTemplates.verification(firstName, verificationCode);

    const result = await sendEmailWithRetry({
      from: EMAIL_FROM,
      to: [email],
      subject,
      html,
      text,
    }, 2);

    if (!result.success) {
      console.error('❌ Error sending verification email:', result.error?.message);
      console.error('   Verification code (use this for testing):', verificationCode);
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

    const resetLink = `${process.env.CLIENT_URL || 'https://app.sanctuaryconnect.org'}/reset-password?token=${resetToken}`;
    const { subject, html, text } = emailTemplates.passwordReset(firstName, resetLink);

    const result = await sendEmailWithRetry({
      from: EMAIL_FROM,
      to: [email],
      subject,
      html,
      text,
    }, 2);

    if (!result.success) {
      console.error('❌ Error sending password reset email:', result.error?.message);
      console.error('   Reset token (use this for testing):', resetToken);
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
 * Send team invitation email
 */
export const sendInviteEmail = async (email, inviterName, churchName, token) => {
  try {
    const inviteLink = `${process.env.CLIENT_URL || 'https://app.sanctuaryconnect.org'}/accept-invite/${token}`;

    if (!hasEmailConfig) {
      console.warn('⚠️  EMAIL not configured. Invite link:', inviteLink);
      return true;
    }

    const { subject, html, text } = emailTemplates.teamInvite(inviterName, churchName, inviteLink);

    const result = await sendEmailWithRetry({
      from: EMAIL_FROM,
      to: [email],
      subject,
      html,
      text,
    }, 2);

    if (!result.success) {
      console.error('❌ Error sending invite email:', result.error?.message);
      console.error('   Invite link (use this for testing):', inviteLink);
      return false;
    }

    console.log('✓ Invite email sent to:', email);
    return true;
  } catch (error) {
    console.error('❌ Unexpected error in sendInviteEmail:', error.message);
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
      from: EMAIL_FROM,
      to: [email],
      subject,
      html,
      text,
    }, 2);

    if (!result.success) {
      console.error('❌ Error sending welcome email:', result.error?.message);
      return false;
    }

    console.log('✓ Welcome email sent to:', email);
    return true;
  } catch (error) {
    console.error('❌ Unexpected error in sendWelcomeEmail:', error.message);
    return false;
  }
};
