import Subscription from '../models/Subscription.js';
import Organization from '../models/Organization.js';
import { PLANS, getAnnualPrice, getPlanById, getAllPlans, getPublicPlans } from '../config/plans.js';

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

    // Calculate period end based on billing cycle
    const now = new Date();
    let periodEnd;
    if (billingCycle === 'annual') {
      periodEnd = new Date(now.setFullYear(now.getFullYear() + 1));
    } else {
      periodEnd = new Date(now.setMonth(now.getMonth() + 1));
    }

    // Determine price
    const price = billingCycle === 'annual' ? getAnnualPrice(plan.price) : plan.price;

    // Create subscription
    const subscription = await Subscription.create({
      organizationId,
      planId,
      billingCycle: billingCycle || 'monthly',
      status: planId === 'seed' ? 'active' : 'active', // Free plans are always active
      currentPeriodStart: new Date(),
      currentPeriodEnd: periodEnd,
      paymentMethod: planId === 'seed' ? null : paymentMethod,
      paymentDetails: planId === 'seed' ? null : paymentDetails,
      billingAddress,
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

    res.status(201).json({
      message: 'Subscription created successfully',
      subscription,
      plan,
    });
  } catch (error) {
    console.error('Error creating subscription:', error);
    res.status(500).json({ error: 'Failed to create subscription' });
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

    await subscription.save();

    const plan = getPlanById(subscription.planId);

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

    res.json({
      planId: subscription.planId,
      planName: plan?.name,
      limits: plan?.limits,
      usage: subscription.usage,
      withinLimits: {
        members: plan?.limits.maxMembers === -1 || subscription.usage.membersCount < plan?.limits.maxMembers,
        branches: plan?.limits.maxBranches === -1 || subscription.usage.branchesCount < plan?.limits.maxBranches,
        sms: plan?.limits.smsCredits === -1 || subscription.usage.smsUsed < plan?.limits.smsCredits,
        transactions: plan?.limits.donationTransactions === -1 || subscription.usage.donationTransactions < plan?.limits.donationTransactions,
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
};
