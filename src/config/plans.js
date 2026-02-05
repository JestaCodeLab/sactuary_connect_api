/**
 * Subscription Plans Configuration
 * Defines the available subscription tiers and their features
 */

export const PLANS = {
  seed: {
    id: 'seed',
    name: 'Seed Plan',
    description: 'Best for small or growing fellowships',
    price: 0,
    currency: 'GHS',
    billingCycle: 'monthly',
    limits: {
      maxMembers: 50,
      maxBranches: 1,
      smsCredits: 0,
      donationTransactions: 20,
    },
    features: [
      { key: 'member_directory', name: 'Member Directory', included: true },
      { key: 'group_management', name: 'Group Management', included: true },
      { key: 'annual_calendar', name: 'Annual Calendar', included: true },
      { key: 'email_notifications', name: 'Email Notifications', included: true },
      { key: 'online_giving', name: 'Online Giving & Donations (20 transactions/month)', included: true },
      { key: 'attendance_tracking', name: 'Attendance Tracking', included: false },
      { key: 'ai_shepherd_alerts', name: 'AI "Shepherd" Alerts', included: false },
      { key: 'sms_credits', name: 'SMS Credits', included: false },
      { key: 'group_dues', name: 'Group Dues Module', included: false },
      { key: 'engagement_vault', name: 'Member Engagement Vault', included: false },
      { key: 'financial_reporting', name: 'Financial Reporting', included: false },
      { key: 'event_management', name: 'Event Management', included: false },
      { key: 'vendor_management', name: 'Vendor Management', included: false },
      { key: 'advanced_analytics', name: 'Advanced Analytics', included: false },
      { key: 'priority_support', name: 'Priority Support', included: false },
    ],
  },

  growth: {
    id: 'growth',
    name: 'Growth Plan',
    description: 'Ideal for established churches',
    price: 550,
    currency: 'GHS',
    billingCycle: 'monthly',
    isPopular: true,
    limits: {
      maxMembers: 250,
      maxBranches: 1,
      smsCredits: 100,
      donationTransactions: 50,
    },
    features: [
      { key: 'member_directory', name: 'Member Directory', included: true },
      { key: 'group_management', name: 'Group Management', included: true },
      { key: 'annual_calendar', name: 'Annual Calendar', included: true },
      { key: 'email_notifications', name: 'Email Notifications', included: true },
      { key: 'online_giving', name: 'Online Giving & Donations (50 transactions/month)', included: true },
      { key: 'attendance_tracking', name: 'Attendance Tracking', included: true },
      { key: 'ai_shepherd_alerts', name: 'AI "Shepherd" Alerts', included: true },
      { key: 'sms_credits', name: 'Monthly 100 SMS Credits', included: true },
      { key: 'group_dues', name: 'Group Dues Module', included: true },
      { key: 'engagement_vault', name: 'Member Engagement Vault', included: true },
      { key: 'financial_reporting', name: 'Basic Financial Reporting', included: true },
      { key: 'event_management', name: 'Event Management', included: false },
      { key: 'vendor_management', name: 'Vendor Management', included: false },
      { key: 'advanced_analytics', name: 'Advanced Analytics', included: false },
      { key: 'priority_support', name: 'Priority Support', included: false },
    ],
  },

  ascend: {
    id: 'ascend',
    name: 'Ascend Plan',
    description: 'Built for large and multi-branch ministries',
    price: 1000,
    currency: 'GHS',
    billingCycle: 'monthly',
    limits: {
      maxMembers: 1000,
      maxBranches: 10,
      smsCredits: 250,
      donationTransactions: -1, // Unlimited
    },
    features: [
      { key: 'member_directory', name: 'Member Directory', included: true },
      { key: 'group_management', name: 'Group Management', included: true },
      { key: 'annual_calendar', name: 'Annual Calendar', included: true },
      { key: 'email_notifications', name: 'Email Notifications', included: true },
      { key: 'online_giving', name: 'Online Giving & Donations (Unlimited)', included: true },
      { key: 'attendance_tracking', name: 'Attendance Tracking', included: true },
      { key: 'ai_shepherd_alerts', name: 'AI "Shepherd" Alerts', included: true },
      { key: 'sms_credits', name: 'Monthly 250 SMS Credits', included: true },
      { key: 'group_dues', name: 'Group Dues Module', included: true },
      { key: 'engagement_vault', name: 'Member Engagement Vault', included: true },
      { key: 'financial_reporting', name: 'Advanced Financial Reporting', included: true },
      { key: 'event_management', name: 'Event Management', included: true },
      { key: 'vendor_management', name: 'Vendor Management', included: true },
      { key: 'advanced_analytics', name: 'Advanced Automation & Analytics', included: true },
      { key: 'priority_support', name: 'Priority Support', included: true },
    ],
  },

  sanctuary: {
    id: 'sanctuary',
    name: 'Sanctuary Plan',
    description: 'Enterprise solution for mega churches',
    price: null, // Custom pricing
    currency: 'GHS',
    billingCycle: 'custom',
    isEnterprise: true,
    limits: {
      maxMembers: -1, // Unlimited
      maxBranches: -1, // Unlimited
      smsCredits: -1, // Custom
      donationTransactions: -1, // Unlimited
    },
    features: [
      { key: 'all_features', name: 'All Growth & Ascend Plan Features', included: true },
      { key: 'unlimited_members', name: 'Unlimited Members', included: true },
      { key: 'unlimited_branches', name: 'Unlimited Branches', included: true },
      { key: 'custom_features', name: 'Custom Features', included: true },
      { key: 'white_label', name: 'White-label Option Available', included: true },
      { key: 'dedicated_support', name: 'Dedicated Account Manager', included: true },
      { key: 'sla', name: 'Service Level Agreement (SLA)', included: true },
      { key: 'custom_integrations', name: 'Custom Integrations', included: true },
    ],
  },
};

// Annual pricing (2 months free = ~17% discount)
export const ANNUAL_DISCOUNT = 2 / 12; // 2 months free

export const getAnnualPrice = (monthlyPrice) => {
  if (!monthlyPrice) return null;
  return Math.round(monthlyPrice * 12 * (1 - ANNUAL_DISCOUNT));
};

export const getPlanById = (planId) => {
  return PLANS[planId] || null;
};

export const getAllPlans = () => {
  return Object.values(PLANS);
};

export const getPublicPlans = () => {
  return Object.values(PLANS).filter(plan => !plan.isEnterprise);
};

export default PLANS;
