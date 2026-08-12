import SmsLog from '../models/SmsLog.js';
import smsService from '../services/smsService.js';
import logger from '../utils/logger.js';

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_LOG_AGE_MS = 48 * 60 * 60 * 1000; // stop polling logs older than 48h

/**
 * Poll FlockText for real delivery status on any SMS log that hasn't
 * reached a terminal state (delivered/failed) yet, so recipient status
 * moves off "submitted" without an admin having to click refresh.
 */
async function pollPendingSmsStatuses() {
  try {
    const logs = await SmsLog.find({
      overallStatus: { $in: ['pending', 'submitted', 'partial'] },
      createdAt: { $gte: new Date(Date.now() - MAX_LOG_AGE_MS) }
    }).select('_id');

    if (logs.length === 0) return;

    logger.info(`[SMS Delivery Status Job] Polling ${logs.length} SMS log(s)`);

    for (const log of logs) {
      try {
        const result = await smsService.updateDeliveryStatuses(log._id);
        if (result.updatedCount > 0) {
          logger.info(`[SMS Delivery Status Job] Log ${log._id}: ${result.updatedCount} recipient(s) updated`);
        }
      } catch (err) {
        logger.error(`[SMS Delivery Status Job] Failed to poll log ${log._id}: ${err.message}`);
      }
    }
  } catch (error) {
    logger.error(`[SMS Delivery Status Job] error: ${error.message}`);
  }
}

export function startSmsDeliveryStatusJob() {
  pollPendingSmsStatuses();
  setInterval(pollPendingSmsStatuses, INTERVAL_MS);
  logger.info('SMS delivery status job started (every 5 minutes)');
}
