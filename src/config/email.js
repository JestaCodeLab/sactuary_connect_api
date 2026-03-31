import { Resend } from 'resend';

// Check if email should be enabled
const EMAIL_ENABLED = process.env.EMAIL_ENABLED !== 'false';
const hasEmailConfig = EMAIL_ENABLED && process.env.RESEND_API_KEY;

let resend = null;

if (hasEmailConfig) {
  resend = new Resend(process.env.RESEND_API_KEY);
  console.log('✓ Resend email client initialized');
} else {
  if (!EMAIL_ENABLED) {
    console.warn('⚠️  EMAIL_ENABLED is set to false - emails will be logged to console');
  } else {
    console.warn('⚠️  No RESEND_API_KEY configured - emails will be logged to console');
    console.warn('⚠️  Get your API key at https://resend.com');
  }
}

// Default "from" address — must match a verified domain in Resend,
// or use "onboarding@resend.dev" for testing
const EMAIL_FROM = process.env.EMAIL_FROM || 'Sanctuary Connect <onboarding@resend.dev>';

export default resend;
export { hasEmailConfig, EMAIL_ENABLED, EMAIL_FROM };
