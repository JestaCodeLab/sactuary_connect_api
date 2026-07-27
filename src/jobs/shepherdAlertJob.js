import cron from 'node-cron';
import ShepherdAlert from '../models/ShepherdAlert.js';
import { executeShepherdAlertCheck } from '../controllers/shepherdAlertController.js';

/**
 * Shepherd Alert Automation
 *
 * Runs daily to check every active ShepherdAlert across all organizations
 * and SMS the configured shepherds when a member's absence count meets
 * the alert's threshold.
 *
 * Schedule: 8:00 AM daily (Africa/Accra timezone) - ahead of the birthday
 * job so both automations don't compete for SMS credits at the same time.
 */
async function runAllShepherdAlerts() {
  console.log('[Shepherd Alert Job] Running shepherd alert automation...');

  const alerts = await ShepherdAlert.find({ isActive: true });
  console.log(`[Shepherd Alert Job] Found ${alerts.length} active alerts to check`);

  let totalTriggered = 0;
  let totalSmsSent = 0;

  for (const alert of alerts) {
    try {
      const logs = await executeShepherdAlertCheck(alert, alert.organizationId);
      const triggered = logs.filter(l => l.triggerred).length;
      const smsSent = logs.filter(l => l.smsSent).length;
      totalTriggered += triggered;
      totalSmsSent += smsSent;
      console.log(`[Shepherd Alert Job] "${alert.name}" (${alert._id}) - triggered: ${triggered}, sms sent: ${smsSent}`);
    } catch (error) {
      console.error(`[Shepherd Alert Job] Failed to run alert ${alert._id}:`, error.message);
    }
  }

  console.log(`[Shepherd Alert Job] Completed - Triggered: ${totalTriggered}, SMS Sent: ${totalSmsSent}`);
}

/**
 * Initialize shepherd alert automation job
 * Runs every day at 8:00 AM
 */
export function initShepherdAlertJob() {
  const schedule = '0 8 * * *';

  console.log('[Shepherd Alert Job] Initializing shepherd alert automation (8:00 AM daily)');

  cron.schedule(schedule, () => {
    console.log('[Shepherd Alert Job] Triggered at', new Date().toISOString());
    runAllShepherdAlerts();
  }, {
    timezone: 'Africa/Accra',
  });

  console.log('[Shepherd Alert Job] Automation scheduled successfully');
}

// Export the manual trigger function for testing
export { runAllShepherdAlerts };
