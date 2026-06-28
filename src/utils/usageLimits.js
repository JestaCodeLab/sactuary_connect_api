import Organization from '../models/Organization.js';
import Subscription from '../models/Subscription.js';
import Member from '../models/Member.js';
import Branch from '../models/Branch.js';
import Department from '../models/Department.js';
import Event from '../models/Event.js';
import SmsCredit from '../models/SmsCredit.js';
import Donation from '../models/Donation.js';
import { PLANS } from '../config/plans.js';

/**
 * Check if organization has reached the member limit
 * Returns { allowed: boolean, current: number, limit: number }
 */
export const checkMemberLimit = async (organizationId) => {
  try {
    const subscription = await Subscription.findOne({ organizationId });
    if (!subscription) {
      return { allowed: false, current: 0, limit: 0, reason: 'No active subscription' };
    }

    const plan = PLANS[subscription.planId];
    if (!plan) {
      return { allowed: false, current: 0, limit: 0, reason: 'Invalid plan' };
    }

    const memberCount = await Member.countDocuments({ organizationId });
    const limit = plan.limits.maxMembers;

    return {
      allowed: memberCount < limit,
      current: memberCount,
      limit,
      remaining: Math.max(0, limit - memberCount),
    };
  } catch (error) {
    console.error('Error checking member limit:', error);
    throw error;
  }
};

/**
 * Check if organization has reached the branch limit
 * Returns { allowed: boolean, current: number, limit: number }
 */
export const checkBranchLimit = async (organizationId) => {
  try {
    const subscription = await Subscription.findOne({ organizationId });
    if (!subscription) {
      console.log('❌ [BRANCH LIMIT] No subscription found for org:', organizationId);
      return { allowed: false, current: 0, limit: 0, reason: 'No active subscription' };
    }

    console.log('✅ [BRANCH LIMIT] Subscription found:', { planId: subscription.planId, status: subscription.status });

    const plan = PLANS[subscription.planId];
    if (!plan) {
      console.log('❌ [BRANCH LIMIT] Invalid plan ID:', subscription.planId);
      return { allowed: false, current: 0, limit: 0, reason: 'Invalid plan' };
    }

    const branchCount = await Branch.countDocuments({ organizationId });
    const limit = plan.limits.maxBranches;

    console.log('📊 [BRANCH LIMIT] Check result:', { branchCount, limit, allowed: branchCount < limit });

    return {
      allowed: branchCount < limit,
      current: branchCount,
      limit,
      remaining: Math.max(0, limit - branchCount),
    };
  } catch (error) {
    console.error('❌ [BRANCH LIMIT] Error checking branch limit:', error);
    throw error;
  }
};

/**
 * Check if organization has SMS credits remaining
 * Returns { allowed: boolean, currentBalance: number, required: number }
 */
export const checkSmsCredits = async (organizationId, recipientCount = 1, message = '') => {
  try {
    const smsCredit = await SmsCredit.findOne({ merchantId: organizationId });
    const isUnicode = message ? /[^ - -ÿ€ŠšŽžŒœŸ]/.test(message) : false;
    const charsPerSegment = isUnicode ? 70 : 160;
    const segments = message ? (Math.ceil(message.length / charsPerSegment) || 1) : 1;
    const creditsRequired = segments * recipientCount;

    if (!smsCredit) {
      return { allowed: false, currentBalance: 0, required: creditsRequired, reason: 'No SMS credits' };
    }

    const hasCredits = smsCredit.balance >= creditsRequired;

    return {
      allowed: hasCredits,
      currentBalance: smsCredit.balance,
      required: creditsRequired,
      shortfall: Math.max(0, creditsRequired - smsCredit.balance),
    };
  } catch (error) {
    console.error('Error checking SMS credits:', error);
    throw error;
  }
};

/**
 * Check if organization has reached donation transaction limit for the month
 * Returns { allowed: boolean, current: number, limit: number }
 */
export const checkDonationLimit = async (organizationId) => {
  try {
    const subscription = await Subscription.findOne({ organizationId });
    if (!subscription) {
      return { allowed: false, current: 0, limit: 0, reason: 'No active subscription' };
    }

    const plan = PLANS[subscription.planId];
    if (!plan) {
      return { allowed: false, current: 0, limit: 0, reason: 'Invalid plan' };
    }

    // Check donation transactions this month
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const donationCount = await Donation.countDocuments({
      organizationId,
      createdAt: { $gte: monthStart, $lte: monthEnd },
    });

    const limit = plan.limits.donationTransactions;
    // -1 means unlimited
    const isUnlimited = limit === -1;
    const allowed = isUnlimited || donationCount < limit;

    return {
      allowed,
      current: donationCount,
      limit: isUnlimited ? 'Unlimited' : limit,
      remaining: isUnlimited ? 'Unlimited' : Math.max(0, limit - donationCount),
    };
  } catch (error) {
    console.error('Error checking donation limit:', error);
    throw error;
  }
};

/**
 * Check if organization has reached the department limit
 * Returns { allowed: boolean, current: number, limit: number }
 */
export const checkDepartmentLimit = async (organizationId) => {
  try {
    const subscription = await Subscription.findOne({ organizationId });
    if (!subscription) {
      return { allowed: false, current: 0, limit: 0, reason: 'No active subscription' };
    }

    const plan = PLANS[subscription.planId];
    if (!plan) {
      return { allowed: false, current: 0, limit: 0, reason: 'Invalid plan' };
    }

    const departmentCount = await Department.countDocuments({ organizationId });
    const limit = plan.limits.maxDepartments;
    // -1 means unlimited
    const isUnlimited = limit === -1;
    const allowed = isUnlimited || departmentCount < limit;

    return {
      allowed,
      current: departmentCount,
      limit: isUnlimited ? 'Unlimited' : limit,
      remaining: isUnlimited ? 'Unlimited' : Math.max(0, limit - departmentCount),
    };
  } catch (error) {
    console.error('Error checking department limit:', error);
    throw error;
  }
};

/**
 * Check if organization has reached the event limit
 * Returns { allowed: boolean, current: number, limit: number }
 */
export const checkEventLimit = async (organizationId) => {
  try {
    const subscription = await Subscription.findOne({ organizationId });
    if (!subscription) {
      return { allowed: false, current: 0, limit: 0, reason: 'No active subscription' };
    }

    const plan = PLANS[subscription.planId];
    if (!plan) {
      return { allowed: false, current: 0, limit: 0, reason: 'Invalid plan' };
    }

    const eventCount = await Event.countDocuments({ organizationId });
    const limit = plan.limits.maxEvents;
    // -1 means unlimited
    const isUnlimited = limit === -1;
    const allowed = isUnlimited || eventCount < limit;

    return {
      allowed,
      current: eventCount,
      limit: isUnlimited ? 'Unlimited' : limit,
      remaining: isUnlimited ? 'Unlimited' : Math.max(0, limit - eventCount),
    };
  } catch (error) {
    console.error('Error checking event limit:', error);
    throw error;
  }
};

/**
 * Get usage summary for an organization
 * Shows current usage vs limits
 */
export const getUsageSummary = async (organizationId) => {
  try {
    const [members, branches, departments, events, sms, donations] = await Promise.all([
      checkMemberLimit(organizationId),
      checkBranchLimit(organizationId),
      checkDepartmentLimit(organizationId),
      checkEventLimit(organizationId),
      checkSmsCredits(organizationId, 1),
      checkDonationLimit(organizationId),
    ]);

    return {
      members,
      branches,
      departments,
      events,
      sms,
      donations,
      hasWarnings: !members.allowed || !branches.allowed || !departments.allowed || !events.allowed || !sms.allowed || !donations.allowed,
    };
  } catch (error) {
    console.error('Error getting usage summary:', error);
    throw error;
  }
};
