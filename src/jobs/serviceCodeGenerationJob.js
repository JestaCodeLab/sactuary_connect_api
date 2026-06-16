import cron from 'node-cron';
import { serviceCodeService } from '../services/serviceCodeService.js';

/**
 * Job to clean up expired service codes
 * Service codes are now generated on-demand by admins instead of automatically 2 hours before events
 * Runs every hour to clean up expired codes
 */
export const initServiceCodeGenerationJob = () => {
  // Run every hour to clean up expired codes
  cron.schedule('0 * * * *', async () => {
    try {
      console.log('[ServiceCodeJob] Running expired service code cleanup...');

      // Clean up expired service codes
      await serviceCodeService.cleanupExpiredCodes();
      console.log('[ServiceCodeJob] Service code cleanup completed');
    } catch (error) {
      console.error('[ServiceCodeJob] Error cleaning up service codes:', error);
    }
  });
};

export default { initServiceCodeGenerationJob };
