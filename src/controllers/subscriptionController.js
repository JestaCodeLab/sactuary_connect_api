import Subscription from '../models/Subscription.js';
import Organization from '../models/Organization.js';
import Member from '../models/Member.js';
import Branch from '../models/Branch.js';
import Department from '../models/Department.js';
import Event from '../models/Event.js';
import SmsLog from '../models/SmsLog.js';
import SmsCredit from '../models/SmsCredit.js';
import Donation from '../models/Donation.js';
import Transaction from '../models/Transaction.js';
import { PLANS, getAnnualPrice, getPlanById, getAllPlans, getPublicPlans } from '../config/plans.js';
import { verifyTransaction, initializeTransaction } from '../services/paystackService.js';
import notificationService from '../services/notificationService.js';
import { branchFilter } from '../utils/branchQuery.js';

const TAX_RATE = 0.1; // 10% platform tax

/**
 * Get all available subscription plans
 * GET /api/subscriptions/plans
 */
export const getPlans = async (req, res) => {
  try {
    const { includeEnterprise } = req.query;

    const plans = includeEnterprise === 'true' ? getAllPlans() : getPublicPlans();

    // Add annual pricing to each plan
    const plansWithAnnual = plans.map(plan => ({
      ...plan,
      annualPrice: getAnnualPrice(plan.price),
    }));

    res.json(plansWithAnnual);
  } catch (error) {
    console.error('Error fetching plans:', error);
    res.status(500).json({ error: 'Failed to fetch plans' });
  }
};

/**
 * Get a specific plan by ID
 * GET /api/subscriptions/plans/:planId
 */
export const getPlan = async (req, res) => {
  try {
    const { planId } = req.params;
    const plan = getPlanById(planId);

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    res.json({
      ...plan,
      annualPrice: getAnnualPrice(plan.price),
    });
  } catch (error) {
    console.error('Error fetching plan:', error);
    res.status(500).json({ error: 'Failed to fetch plan' });
  }
};

/**
 * Create a subscription for an organization
 * POST /api/subscriptions
 */
export const createSubscription = async (req, res) => {
  try {
    const {
      organizationId,
      planId,
      billingCycle,
      paymentMethod,
      paymentDetails,
      billingAddress,
    } = req.body;

    // Validate required fields
    if (!organizationId || !planId) {
      return res.status(400).json({ error: 'Organization ID and plan ID are required' });
    }

    // Validate plan exists
    const plan = getPlanById(planId);
    if (!plan) {
      return res.status(400).json({ error: 'Invalid plan ID' });
    }

    // Check if organization exists
    const organization = await Organization.findById(organizationId);
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Check if subscription already exists
    const existingSubscription = await Subscription.findOne({ organizationId });
    if (existingSubscription) {
      return res.status(400).json({ error: 'Organization already has a subscription. Use update instead.' });
    }

    // Determine price
    const price = billingCycle === 'annual' ? getAnnualPrice(plan.price) : plan.price;

    // For paid plans, verify Paystack payment
    let paystackData = null;
    if (plan.price > 0) {
      const reference = paymentDetails?.reference;
      if (!reference) {
        return res.status(400).json({ error: 'Payment reference is required for paid plans' });
      }

      const verification = await verifyTransaction(reference);
      if (!verification.verified) {
        return res.status(400).json({ error: verification.message || 'Payment verification failed' });
      }

      // Verify amount matches (price + tax, in pesewas)
      const expectedAmount = Math.round((price + price * TAX_RATE) * 100);
      if (verification.data.amount < expectedAmount) {
        return res.status(400).json({
          error: `Payment amount mismatch. Expected at least ${expectedAmount} pesewas, got ${verification.data.amount}`,
        });
      }

      paystackData = verification.data;
    }

    // Calculate period end based on billing cycle
    const now = new Date();
    let periodEnd;
    if (billingCycle === 'annual') {
      periodEnd = new Date(new Date(now).setFullYear(now.getFullYear() + 1));
    } else {
      periodEnd = new Date(new Date(now).setMonth(now.getMonth() + 1));
    }

    // Create subscription
    // Initialize usage with current counts
    const membersCount = await Member.countDocuments({ organizationId });
    const branchesCount = await Branch.countDocuments({ organizationId });

    const subscription = await Subscription.create({
      organizationId,
      planId,
      billingCycle: billingCycle || 'monthly',
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: periodEnd,
      usage: {
        membersCount,
        branchesCount,
        smsUsed: 0,
        donationTransactions: 0,
      },
      ...(plan.price > 0 && {
        paymentMethod,
        paymentDetails,
        billingAddress,
        paystackReference: paystackData?.reference,
        paystackCustomerCode: paystackData?.customer?.customer_code,
        paymentHistory: [{
          reference: paystackData?.reference,
          amount: paystackData?.amount / 100, // convert pesewas to GHS
          currency: paystackData?.currency || 'GHS',
          channel: paystackData?.channel,
          paidAt: paystackData?.paidAt || new Date(),
          planId,
          type: 'initial',
        }],
      }),
      priceAtSubscription: {
        amount: price,
        currency: plan.currency,
      },
    });

    // Update organization with subscription reference
    await Organization.findByIdAndUpdate(organizationId, {
      subscriptionId: subscription._id,
      updatedAt: new Date(),
    });

    // Credit SMS based on plan
    if (plan.limits.smsCredits > 0) {
      const smsCredits = await SmsCredit.getOrCreate(organizationId, 0);
      await smsCredits.addCredits(
        plan.limits.smsCredits,
        'bonus',
        `SMS credits from ${plan.name} subscription`,
        paystackData?.reference || 'initial'
      );
    }

    // Record in unified transaction ledger
    if (plan.price > 0 && paystackData) {
      const subtotal = price;
      const taxAmount = Math.round(price * TAX_RATE);
      await Transaction.create({
        organizationId,
        type: 'subscription_payment',
        direction: 'inflow',
        amount: paystackData.amount / 100,
        subtotal,
        taxAmount,
        taxRate: TAX_RATE,
        currency: paystackData.currency || 'GHS',
        status: 'completed',
        paymentMethod: paystackData.channel === 'mobile_money' ? 'momo' : 'card',
        paymentProvider: 'paystack',
        providerReference: paystackData.reference,
        channel: paystackData.channel,
        relatedModel: 'Subscription',
        relatedId: subscription._id,
        description: `Initial subscription - ${plan.name} plan`,
        initiatedBy: req.user.userId,
        metadata: { planId, billingCycle: billingCycle || 'monthly', upgradeType: 'initial' },
      });
    }

    // Send notification
    try {
      await notificationService.createNotification(
        req.user.userId,
        organizationId,
        'subscription_created',
        `✓ Subscription activated: ${plan.name} plan`,
        `Your ${plan.name} subscription is now active. You have access to all ${plan.name} features.`,
        {
          priority: 'high',
          channels: { inApp: true, email: true },
          relatedModel: 'Subscription',
          relatedModelId: subscription._id,
          actionUrl: '/dashboard/settings/subscription',
        }
      );
    } catch (notificationError) {
      console.error('Error sending subscription notification:', notificationError);
    }

    res.status(201).json({
      message: 'Subscription created successfully',
      subscription,
      plan,
    });
  } catch (error) {
    console.error('Error creating subscription:', error);
    res.status(500).json({ error: error.message || 'Failed to create subscription' });
  }
};

/**
 * Get subscription for an organization
 * GET /api/subscriptions/:organizationId
 */
export const getSubscription = async (req, res) => {
  try {
    const { organizationId } = req.params;

    const subscription = await Subscription.findOne({ organizationId });

    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    const plan = getPlanById(subscription.planId);

    res.json({
      subscription,
      plan,
      isActive: subscription.status === 'active' || subscription.status === 'trialing',
    });
  } catch (error) {
    console.error('Error fetching subscription:', error);
    res.status(500).json({ error: 'Failed to fetch subscription' });
  }
};

/**
 * Update subscription (change plan, billing cycle, etc.)
 * PUT /api/subscriptions/:organizationId
 */
export const updateSubscription = async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { planId, billingCycle, paymentMethod, paymentDetails, billingAddress } = req.body;

    const subscription = await Subscription.findOne({ organizationId });

    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    // If changing plan, validate new plan
    if (planId && planId !== subscription.planId) {
      const newPlan = getPlanById(planId);
      if (!newPlan) {
        return res.status(400).json({ error: 'Invalid plan ID' });
      }

      subscription.planId = planId;

      // Update price if plan changed
      const price = billingCycle === 'annual' || subscription.billingCycle === 'annual'
        ? getAnnualPrice(newPlan.price)
        : newPlan.price;

      subscription.priceAtSubscription = {
        amount: price,
        currency: newPlan.currency,
      };
    }

    // Update billing cycle if provided
    if (billingCycle && billingCycle !== subscription.billingCycle) {
      subscription.billingCycle = billingCycle;

      // Recalculate period end
      const now = new Date();
      if (billingCycle === 'annual') {
        subscription.currentPeriodEnd = new Date(now.setFullYear(now.getFullYear() + 1));
      } else {
        subscription.currentPeriodEnd = new Date(now.setMonth(now.getMonth() + 1));
      }
    }

    // Update payment info if provided
    if (paymentMethod) {
      subscription.paymentMethod = paymentMethod;
    }
    if (paymentDetails) {
      subscription.paymentDetails = paymentDetails;
    }
    if (billingAddress) {
      subscription.billingAddress = billingAddress;
    }

    const oldPlanId = subscription.planId;
    await subscription.save();

    const plan = getPlanById(subscription.planId);
    const oldPlan = getPlanById(oldPlanId);

    // Send notification for plan change
    if (planId && planId !== oldPlanId) {
      try {
        const isUpgrade = plan.tier > oldPlan.tier;
        await notificationService.createNotification(
          req.user.userId,
          organizationId,
          isUpgrade ? 'subscription_upgraded' : 'subscription_downgraded',
          isUpgrade ? `🚀 Plan upgraded: ${plan.name}` : `Plan changed: ${plan.name}`,
          isUpgrade
            ? `Your subscription has been upgraded to ${plan.name} with more features and capacity.`
            : `Your subscription has been changed to ${plan.name}. Some features may be restricted.`,
          {
            priority: 'high',
            channels: { inApp: true, email: true },
            relatedModel: 'Subscription',
            relatedModelId: subscription._id,
            actionUrl: '/dashboard/settings/subscription',
          }
        );
      } catch (notificationError) {
        console.error('Error sending subscription update notification:', notificationError);
      }
    }

    res.json({
      message: 'Subscription updated successfully',
      subscription,
      plan,
    });
  } catch (error) {
    console.error('Error updating subscription:', error);
    res.status(500).json({ error: 'Failed to update subscription' });
  }
};

/**
 * Cancel subscription
 * POST /api/subscriptions/:organizationId/cancel
 */
export const cancelSubscription = async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { cancelImmediately } = req.body;

    const subscription = await Subscription.findOne({ organizationId });

    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    if (cancelImmediately) {
      subscription.status = 'cancelled';
      subscription.cancelledAt = new Date();
    } else {
      // Cancel at end of billing period
      subscription.cancelAtPeriodEnd = true;
    }

    await subscription.save();

    // Send notification
    try {
      await notificationService.createNotification(
        req.user.userId,
        organizationId,
        'subscription_cancelled',
        '❌ Subscription cancelled',
        cancelImmediately
          ? 'Your subscription has been cancelled immediately. You will lose access to paid features.'
          : 'Your subscription will be cancelled at the end of your billing period.',
        {
          priority: 'high',
          channels: { inApp: true, email: true },
          relatedModel: 'Subscription',
          relatedModelId: subscription._id,
          actionUrl: '/dashboard/settings/subscription',
        }
      );
    } catch (notificationError) {
      console.error('Error sending cancellation notification:', notificationError);
    }

    res.json({
      message: cancelImmediately
        ? 'Subscription cancelled immediately'
        : 'Subscription will be cancelled at the end of the billing period',
      subscription,
    });
  } catch (error) {
    console.error('Error cancelling subscription:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
};

/**
 * Reactivate a cancelled subscription
 * POST /api/subscriptions/:organizationId/reactivate
 */
export const reactivateSubscription = async (req, res) => {
  try {
    const { organizationId } = req.params;

    const subscription = await Subscription.findOne({ organizationId });

    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    if (subscription.status === 'active') {
      return res.status(400).json({ error: 'Subscription is already active' });
    }

    // If cancelled but period hasn't ended, just reactivate
    if (subscription.cancelAtPeriodEnd && new Date() < subscription.currentPeriodEnd) {
      subscription.cancelAtPeriodEnd = false;
      subscription.status = 'active';
    } else {
      // Create new billing period
      const now = new Date();
      subscription.status = 'active';
      subscription.cancelAtPeriodEnd = false;
      subscription.cancelledAt = null;
      subscription.currentPeriodStart = now;

      if (subscription.billingCycle === 'annual') {
        subscription.currentPeriodEnd = new Date(now.setFullYear(now.getFullYear() + 1));
      } else {
        subscription.currentPeriodEnd = new Date(now.setMonth(now.getMonth() + 1));
      }
    }

    await subscription.save();

    res.json({
      message: 'Subscription reactivated successfully',
      subscription,
    });
  } catch (error) {
    console.error('Error reactivating subscription:', error);
    res.status(500).json({ error: 'Failed to reactivate subscription' });
  }
};

/**
 * Check feature access for an organization
 * GET /api/subscriptions/:organizationId/features/:featureKey
 */
export const checkFeature = async (req, res) => {
  try {
    const { organizationId, featureKey } = req.params;

    const subscription = await Subscription.findOne({ organizationId });

    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    const plan = getPlanById(subscription.planId);
    const feature = plan?.features.find(f => f.key === featureKey);

    res.json({
      featureKey,
      hasAccess: feature?.included || false,
      planId: subscription.planId,
      planName: plan?.name,
    });
  } catch (error) {
    console.error('Error checking feature:', error);
    res.status(500).json({ error: 'Failed to check feature access' });
  }
};

/**
 * Check usage limits for an organization
 * GET /api/subscriptions/:organizationId/limits
 */
export const checkLimits = async (req, res) => {
  try {
    const { organizationId } = req.params;

    const subscription = await Subscription.findOne({ organizationId });

    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    const plan = getPlanById(subscription.planId);

    // Apply branch filtering to counts (if user has branch context)
    const filter = branchFilter(req);

    // Get current counts from database with branch scoping
    // For org-level counts, use organizationId filter only (no branch filter)
    const orgFilter = { organizationId };
    
    const membersCount = await Member.countDocuments(orgFilter);
    const branchesCount = await Branch.countDocuments(orgFilter);
    const departmentsCount = await Department.countDocuments(filter);
    const eventsCount = await Event.countDocuments(filter);
    
    // Count SMS and donations for current month
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const smsUsed = await SmsLog.countDocuments({
      organizationId,
      createdAt: { $gte: monthStart },
    });
    
    const donationsCount = await Donation.countDocuments({
      organizationId,
      createdAt: { $gte: monthStart },
    });

    // Build usage object with fresh counts
    const usageWithCounts = {
      membersCount,
      branchesCount,
      departmentsCount,
      eventsCount,
      smsUsed,
      donationTransactions: donationsCount,
    };

    res.json({
      planId: subscription.planId,
      planName: plan?.name,
      limits: plan?.limits,
      planFeatures: plan?.features,
      usage: usageWithCounts,
      withinLimits: {
        members: plan?.limits.maxMembers === -1 || membersCount <= plan?.limits.maxMembers,
        branches: plan?.limits.maxBranches === -1 || branchesCount <= plan?.limits.maxBranches,
        departments: plan?.limits.maxDepartments === -1 || departmentsCount <= plan?.limits.maxDepartments,
        events: plan?.limits.maxEvents === -1 || eventsCount <= plan?.limits.maxEvents,
        sms: plan?.limits.smsCredits === -1 || smsUsed <= plan?.limits.smsCredits,
        transactions: plan?.limits.donationTransactions === -1 || donationsCount <= plan?.limits.donationTransactions,
      },
    });
  } catch (error) {
    console.error('Error checking limits:', error);
    res.status(500).json({ error: 'Failed to check limits' });
  }
};

/**
 * Update usage counters
 * PUT /api/subscriptions/:organizationId/usage
 */
export const updateUsage = async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { membersCount, branchesCount, smsUsed, donationTransactions } = req.body;

    const subscription = await Subscription.findOne({ organizationId });

    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    if (typeof membersCount === 'number') subscription.usage.membersCount = membersCount;
    if (typeof branchesCount === 'number') subscription.usage.branchesCount = branchesCount;
    if (typeof smsUsed === 'number') subscription.usage.smsUsed = smsUsed;
    if (typeof donationTransactions === 'number') subscription.usage.donationTransactions = donationTransactions;

    await subscription.save();

    res.json({
      message: 'Usage updated successfully',
      usage: subscription.usage,
    });
  } catch (error) {
    console.error('Error updating usage:', error);
    res.status(500).json({ error: 'Failed to update usage' });
  }
};

/**
 * Initialize a Paystack payment for plan upgrade
 * POST /api/subscriptions/:organizationId/initialize-payment
 */
export const initializeUpgrade = async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { planId, billingCycle = 'monthly' } = req.body;

    const subscription = await Subscription.findOne({ organizationId });
    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    const newPlan = getPlanById(planId);
    if (!newPlan) {
      return res.status(400).json({ error: 'Invalid plan ID' });
    }

    if (newPlan.price === 0 || newPlan.price === null) {
      return res.status(400).json({ error: 'Cannot initialize payment for a free or custom plan' });
    }

    const organization = await Organization.findById(organizationId).populate('adminId', 'email');
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const price = billingCycle === 'annual' ? getAnnualPrice(newPlan.price) : newPlan.price;
    const total = Math.round((price + price * TAX_RATE) * 100); // pesewas
    const reference = `upgrade_${organizationId}_${Date.now()}`;

    const email = organization.adminId?.email || req.user?.email;
    if (!email) {
      return res.status(400).json({ error: 'Admin email not found' });
    }

    const result = await initializeTransaction({
      email,
      amount: total,
      currency: newPlan.currency || 'GHS',
      reference,
      metadata: {
        organizationId,
        planId,
        billingCycle,
        type: 'upgrade',
      },
    });

    res.json({
      authorization_url: result.authorization_url,
      access_code: result.access_code,
      reference: result.reference,
      amount: total / 100,
      currency: newPlan.currency || 'GHS',
    });
  } catch (error) {
    console.error('Error initializing upgrade payment:', error);
    res.status(500).json({ error: error.message || 'Failed to initialize payment' });
  }
};

/**
 * Verify Paystack payment and complete plan upgrade
 * POST /api/subscriptions/:organizationId/verify-payment
 */
export const verifyUpgrade = async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { reference, planId, billingCycle = 'monthly' } = req.body;

    if (!reference || !planId) {
      return res.status(400).json({ error: 'Payment reference and plan ID are required' });
    }

    const subscription = await Subscription.findOne({ organizationId });
    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    const newPlan = getPlanById(planId);
    if (!newPlan) {
      return res.status(400).json({ error: 'Invalid plan ID' });
    }

    // Verify with Paystack
    const verification = await verifyTransaction(reference);
    if (!verification.verified) {
      return res.status(400).json({ error: verification.message || 'Payment verification failed' });
    }

    // Verify amount
    const price = billingCycle === 'annual' ? getAnnualPrice(newPlan.price) : newPlan.price;
    const expectedAmount = Math.round((price + price * TAX_RATE) * 100);
    if (verification.data.amount < expectedAmount) {
      return res.status(400).json({
        error: `Payment amount mismatch. Expected at least ${expectedAmount} pesewas, got ${verification.data.amount}`,
      });
    }

    const currentPlan = getPlanById(subscription.planId);
    const isUpgrade = newPlan.price > (currentPlan?.price || 0);

    // Update subscription
    subscription.planId = planId;
    subscription.billingCycle = billingCycle;
    subscription.status = 'active';
    subscription.paystackReference = reference;
    subscription.paystackCustomerCode = verification.data.customer?.customer_code || subscription.paystackCustomerCode;
    subscription.paymentMethod = verification.data.channel === 'mobile_money' ? 'momo' : 'card';

    // Reset billing period
    const now = new Date();
    subscription.currentPeriodStart = now;
    if (billingCycle === 'annual') {
      subscription.currentPeriodEnd = new Date(new Date(now).setFullYear(now.getFullYear() + 1));
    } else {
      subscription.currentPeriodEnd = new Date(new Date(now).setMonth(now.getMonth() + 1));
    }

    subscription.priceAtSubscription = {
      amount: price,
      currency: newPlan.currency,
    };

    // Add to payment history
    subscription.paymentHistory.push({
      reference: verification.data.reference,
      amount: verification.data.amount / 100,
      currency: verification.data.currency || 'GHS',
      channel: verification.data.channel,
      paidAt: verification.data.paidAt || new Date(),
      planId,
      type: isUpgrade ? 'upgrade' : 'renewal',
    });

    await subscription.save();

    // Record in unified transaction ledger
    const subtotal = price;
    const taxAmount = Math.round(price * TAX_RATE);
    await Transaction.create({
      organizationId,
      type: 'subscription_payment',
      direction: 'inflow',
      amount: verification.data.amount / 100,
      subtotal,
      taxAmount,
      taxRate: TAX_RATE,
      currency: verification.data.currency || 'GHS',
      status: 'completed',
      paymentMethod: verification.data.channel === 'mobile_money' ? 'momo' : 'card',
      paymentProvider: 'paystack',
      providerReference: verification.data.reference,
      channel: verification.data.channel,
      relatedModel: 'Subscription',
      relatedId: subscription._id,
      description: `${isUpgrade ? 'Upgrade' : 'Renewal'} - ${newPlan.name} plan`,
      initiatedBy: req.user.userId,
      metadata: { planId, billingCycle, upgradeType: isUpgrade ? 'upgrade' : 'renewal' },
    });

    // Credit SMS based on new plan
    if (newPlan.limits.smsCredits > 0) {
      const smsCredits = await SmsCredit.getOrCreate(organizationId, 0);
      await smsCredits.addCredits(
        newPlan.limits.smsCredits,
        'bonus',
        `SMS credits from ${newPlan.name} subscription`,
        reference
      );
    }

    res.json({
      message: `Successfully ${isUpgrade ? 'upgraded' : 'changed'} to ${newPlan.name}`,
      subscription,
      plan: newPlan,
    });
  } catch (error) {
    console.error('Error verifying upgrade payment:', error);
    res.status(500).json({ error: error.message || 'Failed to verify payment' });
  }
};

/**
 * Debug endpoint - Get current user's subscription details
 * GET /api/subscriptions/debug/me
 */
export const getMySubscriptionDebug = async (req, res) => {
  try {
    const { organizationId } = req.user;
    
    if (!organizationId) {
      return res.status(400).json({ error: 'No organizationId in user token' });
    }

    const org = await Organization.findById(organizationId);
    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const subscription = await Subscription.findOne({ organizationId: org._id });
    
    if (!subscription) {
      return res.status(404).json({
        error: 'No subscription found',
        organizationId: org._id,
      });
    }

    const plan = getPlanById(subscription.planId);

    res.json({
      found: true,
      subscription: {
        id: subscription._id,
        organizationId: subscription.organizationId,
        planId: subscription.planId,
        status: subscription.status,
        createdAt: subscription.createdAt,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
      },
      plan: plan ? {
        id: plan.id,
        name: plan.name,
        features: plan.features.map(f => ({ key: f.key, name: f.name, included: f.included })),
      } : null,
    });
  } catch (error) {
    console.error('Debug subscription error:', error);
    res.status(500).json({ error: error.message });
  }
};

export default {
  getPlans,
  getPlan,
  createSubscription,
  getSubscription,
  updateSubscription,
  cancelSubscription,
  reactivateSubscription,
  checkFeature,
  checkLimits,
  updateUsage,
  initializeUpgrade,
  verifyUpgrade,
  getMySubscriptionDebug,
};
