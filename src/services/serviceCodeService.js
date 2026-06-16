import ServiceCode from '../models/ServiceCode.js';
import { generateServiceCode } from '../utils/serviceCodeGenerator.js';

export const serviceCodeService = {
  /**
   * Generate a service code for a specific event occurrence
   * @param eventId - Event ID
   * @param occurrenceDate - The start date of the occurrence
   * @param organizationId - Organization ID
   * @param branchId - Branch ID
   * @param eventData - Object with startDate and endDate to calculate duration
   */
  generateCodeForOccurrence: async (eventId, occurrenceDate, organizationId, branchId, eventData = null) => {
    try {
      // Check if code already exists for this occurrence
      const existing = await ServiceCode.findOne({
        eventId,
        occurrenceDate: new Date(occurrenceDate),
      });

      if (existing) {
        return existing;
      }

      // Generate new code
      const code = generateServiceCode();

      // Calculate expiration time
      let expiresAt;
      if (eventData?.startDate && eventData?.endDate) {
        // Calculate event duration from template dates
        const eventDuration = new Date(eventData.endDate).getTime() - new Date(eventData.startDate).getTime();
        // Set expiration to occurrence end time + 1 hour buffer
        expiresAt = new Date(new Date(occurrenceDate).getTime() + eventDuration + 60 * 60 * 1000);
      } else {
        // Fallback: expire 3 hours after event start
        expiresAt = new Date(new Date(occurrenceDate).getTime() + 3 * 60 * 60 * 1000);
      }

      const serviceCode = new ServiceCode({
        eventId,
        organizationId,
        branchId,
        occurrenceDate: new Date(occurrenceDate),
        code,
        expiresAt,
      });

      await serviceCode.save();
      return serviceCode;
    } catch (error) {
      console.error('Error generating service code:', error);
      throw error;
    }
  },

  /**
   * Get service code for a specific occurrence
   */
  getCodeForOccurrence: async (eventId, occurrenceDate) => {
    try {
      const serviceCode = await ServiceCode.findOne({
        eventId,
        occurrenceDate: new Date(occurrenceDate),
      });
      return serviceCode;
    } catch (error) {
      console.error('Error fetching service code:', error);
      throw error;
    }
  },

  /**
   * Validate a service code
   */
  validateCode: async (code, eventId, occurrenceDate) => {
    try {
      const now = new Date();
      const serviceCode = await ServiceCode.findOne({
        eventId,
        code,
        occurrenceDate: new Date(occurrenceDate),
        expiresAt: { $gt: now },
      });

      if (serviceCode) {
        // Increment usage count
        serviceCode.usageCount += 1;
        await serviceCode.save();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error validating service code:', error);
      throw error;
    }
  },

  /**
   * Clean up expired service codes
   */
  cleanupExpiredCodes: async () => {
    try {
      const result = await ServiceCode.deleteMany({
        expiresAt: { $lt: new Date() },
      });
      console.log(`Cleaned up ${result.deletedCount} expired service codes`);
      return result;
    } catch (error) {
      console.error('Error cleaning up expired codes:', error);
      throw error;
    }
  },
};
