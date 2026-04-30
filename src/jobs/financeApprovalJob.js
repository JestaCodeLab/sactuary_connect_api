import FinanceAccount from '../models/FinanceAccount.js';
import AuditLog from '../models/AuditLog.js';
import { createMerchantAccount } from '../services/paystackService.js';
import logger from '../utils/logger.js';

/**
 * Job to create Paystack merchant account after superadmin approval
 * This runs asynchronously and updates the FinanceAccount with Paystack details
 */
export const processFinanceAccountApproval = async (financeAccountId, approvedBy) => {
  try {
    logger.info(`[FinanceApprovalJob] Processing finance account: ${financeAccountId}`);

    // Fetch the finance account
    const financeAccount = await FinanceAccount.findById(financeAccountId);
    if (!financeAccount) {
      logger.error(`[FinanceApprovalJob] Finance account not found: ${financeAccountId}`);
      return {
        success: false,
        error: 'Finance account not found',
      };
    }

    // Verify it's in approved status
    if (financeAccount.status !== 'approved') {
      logger.warn(`[FinanceApprovalJob] Finance account not in approved status: ${financeAccount.status}`);
      return {
        success: false,
        error: `Invalid status: ${financeAccount.status}`,
      };
    }

    // Check if Paystack merchant ID already exists (idempotency)
    if (financeAccount.paystackMerchantId) {
      logger.info(`[FinanceApprovalJob] Paystack account already created: ${financeAccount.paystackMerchantId}`);
      return {
        success: true,
        message: 'Paystack account already created',
        paystackMerchantId: financeAccount.paystackMerchantId,
      };
    }

    // Call Paystack API to create merchant account
    logger.info(`[FinanceApprovalJob] Creating Paystack account for: ${financeAccount.businessName}`);
    
    const paystackResult = await createMerchantAccount({
      businessName: financeAccount.businessName,
      ownerFullName: financeAccount.ownerFullName,
      ownerEmail: financeAccount.ownerEmail,
      ownerPhone: financeAccount.ownerPhone,
      bankAccountNumber: financeAccount.bankAccountNumber,
      bankCode: financeAccount.bankCode,
      businessAddress: financeAccount.businessAddress,
    });

    if (!paystackResult.success) {
      logger.error(
        `[FinanceApprovalJob] Failed to create Paystack account: ${paystackResult.error}`
      );

      // Update finance account with error status but keep as approved
      financeAccount.statusHistory.push({
        status: 'approved',
        changedBy: approvedBy,
        notes: `Paystack account creation failed: ${paystackResult.error}. Retry manually.`,
      });
      await financeAccount.save();

      // Log to audit trail
      await AuditLog.create({
        actorId: approvedBy,
        action: 'finance_approval_job_failed',
        targetOrgId: financeAccount.organizationId,
        details: {
          financeAccountId: financeAccount._id,
          error: paystackResult.error,
        },
      });

      return {
        success: false,
        error: paystackResult.error,
        message: 'Paystack account creation failed. Manual retry may be needed.',
      };
    }

    // Update finance account with Paystack details
    financeAccount.paystackMerchantId = paystackResult.paystackMerchantId;
    financeAccount.paystackAuthorizationUrl = paystackResult.paystackAuthorizationUrl;
    financeAccount.paystackLiveMode = paystackResult.liveMode;
    financeAccount.statusHistory.push({
      status: 'approved',
      changedBy: approvedBy,
      notes: `Paystack account created successfully: ${paystackResult.paystackMerchantId}`,
    });

    await financeAccount.save();

    logger.info(
      `[FinanceApprovalJob] SUCCESS - Paystack account created: ${paystackResult.paystackMerchantId}`
    );

    // Log to audit trail
    await AuditLog.create({
      actorId: approvedBy,
      action: 'finance_approval_job_completed',
      targetOrgId: financeAccount.organizationId,
      details: {
        financeAccountId: financeAccount._id,
        paystackMerchantId: paystackResult.paystackMerchantId,
      },
    });

    // TODO: Send email to organization admin confirming Paystack account creation

    return {
      success: true,
      message: 'Paystack account created successfully',
      paystackMerchantId: paystackResult.paystackMerchantId,
    };
  } catch (error) {
    logger.error(
      `[FinanceApprovalJob] Unexpected error processing finance account: ${error.message}`
    );

    return {
      success: false,
      error: error.message,
      message: 'An unexpected error occurred processing the finance account',
    };
  }
};

/**
 * Retry Paystack account creation for a failed finance account
 * Only works if previous creation failed
 */
export const retryPaystackAccountCreation = async (financeAccountId, retryBy) => {
  try {
    const financeAccount = await FinanceAccount.findById(financeAccountId);
    if (!financeAccount) {
      return {
        success: false,
        error: 'Finance account not found',
      };
    }

    if (financeAccount.status !== 'approved') {
      return {
        success: false,
        error: `Cannot retry: account status is ${financeAccount.status}`,
      };
    }

    if (financeAccount.paystackMerchantId) {
      return {
        success: false,
        error: 'Paystack account already exists',
      };
    }

    // Retry creation
    return await processFinanceAccountApproval(financeAccountId, retryBy);
  } catch (error) {
    logger.error(`[FinanceApprovalJob] Error retrying account creation: ${error.message}`);
    return {
      success: false,
      error: error.message,
    };
  }
};

export default { processFinanceAccountApproval, retryPaystackAccountCreation };
