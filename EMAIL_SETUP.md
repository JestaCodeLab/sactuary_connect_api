# Email Service Setup - Sanctuary Connect

## Overview

Sanctuary Connect uses **Nodemailer** to send transactional emails for:
- ✅ Email verification codes during registration
- ✅ Password reset links
- ✅ Welcome emails to new churches

## Email Service Configuration

### Using Gmail (Recommended for Development)

1. **Enable 2-Factor Authentication**
   - Go to https://myaccount.google.com
   - Click "Security" in the left sidebar
   - Enable "2-Step Verification"

2. **Generate an App Password**
   - Go to https://myaccount.google.com/apppasswords
   - Select "Mail" and "Windows Computer" (or your setup)
   - Click "Generate"
   - Copy the 16-character password (without spaces)

3. **Update Your .env File**
   ```env
   EMAIL_SERVICE=gmail
   EMAIL_HOST=smtp.gmail.com
   EMAIL_PORT=587
   EMAIL_SECURE=false
   EMAIL_USER=your-email@gmail.com
   EMAIL_PASSWORD=your-app-password-here
   EMAIL_FROM=Sanctuary Connect <noreply@sanctuaryconnect.com>
   CLIENT_URL=http://localhost:3000
   ```

### Using Other Email Providers

**SendGrid:**
```env
EMAIL_SERVICE=SendGrid
EMAIL_HOST=smtp.sendgrid.net
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=apikey
EMAIL_PASSWORD=SG.your-sendgrid-api-key
```

**Mailgun:**
```env
EMAIL_SERVICE=Mailgun
EMAIL_HOST=smtp.mailgun.org
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=postmaster@your-domain.mailgun.org
EMAIL_PASSWORD=your-mailgun-password
```

## Testing Email Sending

### Option 1: Use Mailtrap (Testing Only)
1. Sign up at https://mailtrap.io
2. Create an inbox
3. Get SMTP credentials from the inbox
4. Update .env with Mailtrap credentials
5. Test emails will appear in the Mailtrap inbox

### Option 2: Manual Testing
```bash
# In the API directory, test with:
npm run dev

# Then register a user in the frontend
# Check console logs for:
# ✓ Verification email sent to: user@example.com
```

## Email Templates

Email templates are defined in `src/services/emailService.js` and include:

1. **Verification Email** - Contains 6-digit verification code
2. **Password Reset Email** - Contains clickable reset link
3. **Welcome Email** - Sent after account setup

All templates are responsive and work on all devices.

## Troubleshooting

### Emails not sending?

**Check 1: Environment Variables**
```bash
# Verify .env is configured
cat .env | grep EMAIL
```

**Check 2: Gmail Security**
- Ensure 2FA is enabled
- Use App Password, not regular password
- Allow "Less secure apps" if not using App Password

**Check 3: Logs**
```
✓ Email service ready       # Service initialized
✓ Verification email sent   # Email sent successfully
⚠️  EMAIL_USER not configured # Missing .env configuration
```

**Check 4: Credentials**
- Test with `telnet smtp.gmail.com 587`
- Ensure no extra spaces in EMAIL_PASSWORD

### Gmail Security Warning
If you see "Less secure app access" warnings:
1. Use App Passwords (recommended)
2. Or enable "Less secure apps" temporarily for testing

## Development vs Production

**Development:**
- Use Gmail or Mailtrap
- Emails printed to console if not configured
- Registration still succeeds without email

**Production:**
- Use dedicated email service (SendGrid, Mailgun, AWS SES)
- Set EMAIL_SECURE=true for port 465
- Monitor email delivery rates and bounces
- Implement email templates with your branding

## Next Steps

1. Configure .env with your email provider
2. Restart the API server: `npm run dev`
3. Test registration flow - you should receive verification email
4. Check console for email delivery confirmation
