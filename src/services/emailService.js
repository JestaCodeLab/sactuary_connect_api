const SUPPORT_CONTACT_EMAIL = process.env.SUPPORT_CONTACT_EMAIL || 'support@sanctuaryconnect.com';

export const emailTemplates = {
  verification: (name, code) => ({
    subject: 'Verify Your Sanctuary Connect Account',
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #3B82F6 0%, #1E40AF 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
            .code-box { background: white; border: 2px dashed #3B82F6; padding: 20px; text-align: center; margin: 30px 0; border-radius: 8px; }
            .code { font-size: 32px; font-weight: bold; letter-spacing: 2px; color: #3B82F6; font-family: monospace; }
            .expiry { color: #6B7280; font-size: 14px; margin-top: 20px; }
            .footer { text-align: center; color: #9CA3AF; font-size: 12px; margin-top: 30px; }
            .warning { color: #DC2626; font-size: 12px; margin-top: 10px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">⛪ Sanctuary Connect</h1>
              <p style="margin: 10px 0 0 0;">Email Verification</p>
            </div>
            <div class="content">
              <p>Hi ${name},</p>
              <p>Welcome to Sanctuary Connect! We're excited to have you join our community management platform.</p>
              <p>To complete your account setup, please verify your email address using the code below:</p>
              <div class="code-box">
                <div class="code">${code}</div>
              </div>
              <p>This verification code will expire in <strong>10 minutes</strong>.</p>
              <p class="expiry">If you didn't create this account or have any questions, please contact our support team.</p>
            </div>
            <div class="footer">
              <p>© 2024 Sanctuary Connect. All rights reserved.</p>
              <p class="warning">This is an automated message, please do not reply to this email.</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `Hi ${name},\n\nWelcome to Sanctuary Connect!\n\nYour verification code is: ${code}\n\nThis code will expire in 10 minutes.\n\nIf you didn't create this account, please ignore this email.\n\n© 2024 Sanctuary Connect`,
  }),

  passwordReset: (name, resetLink) => ({
    subject: 'Reset Your Sanctuary Connect Password',
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #3B82F6 0%, #1E40AF 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
            .cta-button { background: #3B82F6; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 30px 0; font-weight: bold; }
            .footer { text-align: center; color: #9CA3AF; font-size: 12px; margin-top: 30px; }
            .warning { color: #DC2626; font-size: 12px; margin-top: 10px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">🔐 Password Reset</h1>
              <p style="margin: 10px 0 0 0;">Sanctuary Connect</p>
            </div>
            <div class="content">
              <p>Hi ${name},</p>
              <p>We received a request to reset your Sanctuary Connect password. Click the button below to reset it:</p>
              <div style="text-align: center;">
                <a href="${resetLink}" class="cta-button">Reset Password</a>
              </div>
              <p>This link will expire in <strong>1 hour</strong>. If you didn't request this, you can ignore this email.</p>
              <p class="warning">Never share your password reset link with anyone.</p>
            </div>
            <div class="footer">
              <p>© 2024 Sanctuary Connect. All rights reserved.</p>
              <p class="warning">This is an automated message, please do not reply to this email.</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `Hi ${name},\n\nWe received a request to reset your Sanctuary Connect password.\n\nClick here to reset: ${resetLink}\n\nThis link expires in 1 hour.\n\nIf you didn't request this, please ignore this email.\n\n© 2024 Sanctuary Connect`,
  }),

  teamInvite: (inviterName, churchName, inviteLink) => ({
    subject: `You've been invited to manage ${churchName} on Sanctuary Connect`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #3B82F6 0%, #1E40AF 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
            .cta-button { background: #3B82F6; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 30px 0; font-weight: bold; }
            .note { color: #6B7280; font-size: 13px; margin-top: 20px; }
            .footer { text-align: center; color: #9CA3AF; font-size: 12px; margin-top: 30px; }
            .warning { color: #DC2626; font-size: 12px; margin-top: 10px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">⛪ Sanctuary Connect</h1>
              <p style="margin: 10px 0 0 0;">Team Invitation</p>
            </div>
            <div class="content">
              <p>Hi there,</p>
              <p><strong>${inviterName}</strong> has invited you to join <strong>${churchName}</strong> as an administrator on Sanctuary Connect.</p>
              <p>As an admin, you'll be able to manage members, events, finances, and more for ${churchName}.</p>
              <div style="text-align: center;">
                <a href="${inviteLink}" class="cta-button">Accept Invitation</a>
              </div>
              <p class="note">This invitation will expire in <strong>48 hours</strong>. If you weren't expecting this invite, you can safely ignore this email.</p>
            </div>
            <div class="footer">
              <p>© 2024 Sanctuary Connect. All rights reserved.</p>
              <p class="warning">This is an automated message, please do not reply to this email.</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `Hi there,\n\n${inviterName} has invited you to join ${churchName} as an administrator on Sanctuary Connect.\n\nAccept your invitation here: ${inviteLink}\n\nThis invitation expires in 48 hours.\n\nIf you weren't expecting this, you can ignore this email.\n\n© 2024 Sanctuary Connect`,
  }),

  subscriptionExpiringSoon: (name, churchName, planName, daysLeft, expiryDate, renewLink) => ({
    subject: `Your ${planName} subscription expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
            .cta-button { background: #3B82F6; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 30px 0; font-weight: bold; }
            .footer { text-align: center; color: #9CA3AF; font-size: 12px; margin-top: 30px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">⏳ Subscription Expiring Soon</h1>
              <p style="margin: 10px 0 0 0;">Sanctuary Connect</p>
            </div>
            <div class="content">
              <p>Hi ${name},</p>
              <p><strong>${churchName}</strong>'s <strong>${planName}</strong> subscription expires on <strong>${expiryDate}</strong> (in ${daysLeft} day${daysLeft === 1 ? '' : 's'}).</p>
              <p>Renew now to keep uninterrupted access to your plan's features and limits.</p>
              <div style="text-align: center;">
                <a href="${renewLink}" class="cta-button">Renew Subscription</a>
              </div>
              <p style="color: #6B7280; font-size: 14px;">If your subscription lapses, ${churchName} will lose access to features not included on the free plan until it's renewed.</p>
            </div>
            <div class="footer">
              <p>© 2024 Sanctuary Connect. All rights reserved.</p>
              <p>This is an automated message, please do not reply to this email.</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `Hi ${name},\n\n${churchName}'s ${planName} subscription expires on ${expiryDate} (in ${daysLeft} day${daysLeft === 1 ? '' : 's'}).\n\nRenew now: ${renewLink}\n\nIf your subscription lapses, ${churchName} will lose access to features not included on the free plan until it's renewed.\n\n© 2024 Sanctuary Connect`,
  }),

  subscriptionExpired: (name, churchName, planName, renewLink) => ({
    subject: `Your ${planName} subscription has expired`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #DC2626 0%, #991B1B 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
            .cta-button { background: #3B82F6; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 30px 0; font-weight: bold; }
            .footer { text-align: center; color: #9CA3AF; font-size: 12px; margin-top: 30px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">⚠️ Subscription Expired</h1>
              <p style="margin: 10px 0 0 0;">Sanctuary Connect</p>
            </div>
            <div class="content">
              <p>Hi ${name},</p>
              <p><strong>${churchName}</strong>'s <strong>${planName}</strong> subscription has expired. Features not included on the free plan are no longer available until you renew.</p>
              <div style="text-align: center;">
                <a href="${renewLink}" class="cta-button">Renew Now</a>
              </div>
              <p style="color: #6B7280; font-size: 14px;">Your data is safe - renewing restores full access immediately.</p>
            </div>
            <div class="footer">
              <p>© 2024 Sanctuary Connect. All rights reserved.</p>
              <p>This is an automated message, please do not reply to this email.</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `Hi ${name},\n\n${churchName}'s ${planName} subscription has expired. Features not included on the free plan are no longer available until you renew.\n\nRenew now: ${renewLink}\n\nYour data is safe - renewing restores full access immediately.\n\n© 2024 Sanctuary Connect`,
  }),

  welcome: (churchName) => ({
    subject: 'Welcome to Sanctuary Connect - Getting Started',
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #3B82F6 0%, #1E40AF 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
            .feature { margin: 20px 0; padding: 15px; background: white; border-left: 4px solid #3B82F6; }
            .feature h3 { margin: 0 0 5px 0; color: #1F2937; }
            .feature p { margin: 0; color: #6B7280; font-size: 14px; }
            .footer { text-align: center; color: #9CA3AF; font-size: 12px; margin-top: 30px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">⛪ Sanctuary Connect</h1>
              <p style="margin: 10px 0 0 0;">Welcome, ${churchName}!</p>
            </div>
            <div class="content">
              <p>Thank you for choosing Sanctuary Connect! We're thrilled to partner with ${churchName} in managing your church community.</p>
              
              <h2 style="color: #1F2937; margin-top: 30px;">Getting Started:</h2>
              
              <div class="feature">
                <h3>👥 Manage Members</h3>
                <p>Build and organize your member directory with contacts, attendance tracking, and group management.</p>
              </div>
              
              <div class="feature">
                <h3>📅 Plan Events</h3>
                <p>Create and manage church events, services, and activities with easy scheduling and notifications.</p>
              </div>
              
              <div class="feature">
                <h3>💝 Track Donations</h3>
                <p>Securely process and track financial contributions with detailed reporting and receipts.</p>
              </div>
              
              <div class="feature">
                <h3>📊 Get Insights</h3>
                <p>View analytics and reports on your church's growth, engagement, and finances.</p>
              </div>
              
              <p style="margin-top: 30px; color: #6B7280; font-size: 14px;">Need help? Visit our <strong>Help Center</strong> or contact our support team at <strong>${SUPPORT_CONTACT_EMAIL}</strong></p>
            </div>
            <div class="footer">
              <p>© 2024 Sanctuary Connect. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `Welcome, ${churchName}!\n\nThank you for choosing Sanctuary Connect.\n\nKey Features:\n- Manage Members: Build your member directory\n- Plan Events: Schedule services and activities\n- Track Donations: Secure financial tracking\n- Get Insights: View analytics and reports\n\nFor support, contact ${SUPPORT_CONTACT_EMAIL}\n\n© 2024 Sanctuary Connect`,
  }),

  supportTicketSubmitted: (churchName, submitterName, type, subject, description) => {
    const typeLabel = type === 'feature_request' ? 'Feature Request' : 'Support Ticket';
    return {
      subject: `New ${typeLabel}: ${subject}`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #3B82F6 0%, #1E40AF 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
              .meta { color: #6B7280; font-size: 14px; margin: 0 0 20px 0; }
              .box { background: white; border: 1px solid #E5E7EB; border-radius: 8px; padding: 20px; white-space: pre-wrap; }
              .footer { text-align: center; color: #9CA3AF; font-size: 12px; margin-top: 30px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1 style="margin: 0;">📩 New ${typeLabel}</h1>
              </div>
              <div class="content">
                <p class="meta"><strong>${churchName}</strong> · submitted by ${submitterName}</p>
                <h2 style="color: #1F2937; margin: 0 0 10px 0;">${subject}</h2>
                <div class="box">${description}</div>
              </div>
              <div class="footer">
                <p>© 2024 Sanctuary Connect. Review this in the superadmin dashboard.</p>
              </div>
            </div>
          </body>
        </html>
      `,
      text: `New ${typeLabel} from ${churchName} (submitted by ${submitterName})\n\n${subject}\n\n${description}\n\nReview it in the superadmin dashboard.`,
    };
  },
};
