import cron from 'node-cron';
import Member from '../models/Member.js';
import Organization from '../models/Organization.js';
import smsService from '../services/smsService.js';

/**
 * Birthday SMS Automation
 * 
 * This job runs daily at 9:00 AM to send automated birthday greetings to members.
 * 
 * Features:
 * - Checks all members for birthdays matching today's date
 * - Uses customizable message template per organization
 * - Supports template variables: {{firstName}}, {{lastName}}, {{age}}, {{churchName}}
 * - Can be enabled/disabled via organization settings (birthdayAutoSendEnabled)
 * - Logs all send attempts for debugging
 * 
 * Configuration:
 * - Schedule: 9:00 AM daily (Africa/Accra timezone)
 * - Settings managed in Organization model (birthdayMessageTemplate, birthdayAutoSendEnabled)
 */

// Default birthday message template
const DEFAULT_BIRTHDAY_MESSAGE = "Happy Birthday {{firstName}}! 🎉🎂 May God bless you abundantly on your special day. You are loved and cherished. - {{churchName}}";

/**
 * Send birthday SMS to all members whose birthday is today
 */
async function sendBirthdaySMS() {
  try {
    console.log('[Birthday Job] Running birthday SMS automation...');
    
    // Get today's date (month and day only)
    const today = new Date();
    const currentMonth = today.getMonth() + 1; // 1-12
    const currentDay = today.getDate();

    console.log(`[Birthday Job] Checking for birthdays on ${currentMonth}/${currentDay}`);

    // Find all members with birthdays today
    const members = await Member.find({
      dateOfBirth: { $exists: true, $ne: null }
    }).populate('organizationId', 'churchName birthdayMessageTemplate birthdayAutoSendEnabled');

    let birthdayCount = 0;
    const organizationGroups = {};

    // Filter members with birthday today and group by organization
    for (const member of members) {
      if (!member.dateOfBirth) continue;

      const birthDate = new Date(member.dateOfBirth);
      const birthMonth = birthDate.getMonth() + 1;
      const birthDay = birthDate.getDate();

      // Check if birthday matches today
      if (birthMonth === currentMonth && birthDay === currentDay) {
        birthdayCount++;
        
        const orgId = member.organizationId._id.toString();
        if (!organizationGroups[orgId]) {
          organizationGroups[orgId] = {
            organization: member.organizationId,
            members: []
          };
        }
        organizationGroups[orgId].members.push(member);
      }
    }

    console.log(`[Birthday Job] Found ${birthdayCount} birthdays today across ${Object.keys(organizationGroups).length} organizations`);

    // Send birthday SMS for each organization
    let totalSent = 0;
    let totalFailed = 0;

    for (const orgId in organizationGroups) {
      const { organization, members } = organizationGroups[orgId];
      
      // Check if auto-send is enabled for this organization
      if (organization.birthdayAutoSendEnabled === false) {
        console.log(`[Birthday Job] Skipping ${organization.churchName} - auto-send disabled`);
        continue;
      }
      
      // Get custom template or use default
      const template = organization.birthdayMessageTemplate || DEFAULT_BIRTHDAY_MESSAGE;
      
      console.log(`[Birthday Job] Sending ${members.length} birthday SMS for ${organization.churchName}`);

      // Send SMS to each birthday member
      for (const member of members) {
        try {
          if (!member.phone) {
            console.log(`[Birthday Job] Skipping ${member.firstName} ${member.lastName} - no phone number`);
            continue;
          }

          // Calculate age
          const birthYear = new Date(member.dateOfBirth).getFullYear();
          const age = today.getFullYear() - birthYear;

          // Process template variables
          let message = template
            .replace(/\{\{firstName\}\}/g, member.firstName || '')
            .replace(/\{\{lastName\}\}/g, member.lastName || '')
            .replace(/\{\{age\}\}/g, age.toString())
            .replace(/\{\{churchName\}\}/g, organization.churchName || '');

          // Send SMS via BMS Africa
          const result = await smsService.sendSingle({
            phone: member.phone,
            message,
            merchantId: organization._id,
            userId: null,
            category: 'birthday'
          });

          if (result.success) {
            totalSent++;
            console.log(`[Birthday Job] ✓ Sent to ${member.firstName} ${member.lastName} (${member.phone})`);
          } else {
            totalFailed++;
            console.log(`[Birthday Job] ✗ Failed to send to ${member.firstName} ${member.lastName}: ${result.error}`);
          }
        } catch (error) {
          totalFailed++;
          console.error(`[Birthday Job] Error sending to ${member.firstName} ${member.lastName}:`, error.message);
        }
      }
    }

    console.log(`[Birthday Job] Completed - Sent: ${totalSent}, Failed: ${totalFailed}`);
  } catch (error) {
    console.error('[Birthday Job] Fatal error:', error);
  }
}

/**
 * Initialize birthday automation job
 * Runs every day at 9:00 AM
 */
export function initBirthdayJob() {
  // Schedule: Run at 9:00 AM every day
  // Cron format: second minute hour day month weekday
  // '0 9 * * *' = At 9:00 AM every day
  const schedule = '0 9 * * *';

  console.log('[Birthday Job] Initializing birthday SMS automation (9:00 AM daily)');

  cron.schedule(schedule, () => {
    console.log('[Birthday Job] Triggered at', new Date().toISOString());
    sendBirthdaySMS();
  }, {
    timezone: "Africa/Accra" // Adjust timezone as needed
  });

  console.log('[Birthday Job] Automation scheduled successfully');

  // Optional: Run immediately on startup for testing
  // Uncomment the line below to test on server start
  // sendBirthdaySMS();
}

// Export the manual trigger function for testing
export { sendBirthdaySMS };
