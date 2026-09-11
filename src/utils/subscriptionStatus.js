/**
 * Single source of truth for "is this subscription usable right now" and the
 * renewal-reminder/grace-period window around it. Used by both the feature
 * gate (requireFeature) and the subscription-info endpoints so they can never
 * drift into disagreeing about whether an org still has access.
 */

// How many days before currentPeriodEnd the renewal banner should start
// showing on every dashboard page.
export const RENEWAL_REMINDER_DAYS = 7;

// How many days past currentPeriodEnd an org keeps full access (with the
// banner turned urgent) before being auto-downgraded to the free plan.
export const GRACE_PERIOD_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A subscription is usable through the end of its grace period, not just
 * through currentPeriodEnd - the grace period exists so a lapsed renewal
 * doesn't instantly cut off access.
 */
export const isSubscriptionActive = (subscription) => {
  if (!subscription) return false;
  if (subscription.status !== 'active' && subscription.status !== 'trialing') return false;
  const graceEnd = new Date(subscription.currentPeriodEnd).getTime() + GRACE_PERIOD_DAYS * DAY_MS;
  return graceEnd >= Date.now();
};

/**
 * Returns the renewal-banner state for a subscription, or null if it's not
 * due for a reminder yet (more than RENEWAL_REMINDER_DAYS out).
 */
export const getRenewalWindowStatus = (subscription) => {
  if (!subscription) return null;
  const now = Date.now();
  const periodEnd = new Date(subscription.currentPeriodEnd).getTime();
  const graceEnd = periodEnd + GRACE_PERIOD_DAYS * DAY_MS;

  if (now > graceEnd) return null; // already past grace - no banner, it's just downgraded (or will be shortly)
  if (now < periodEnd - RENEWAL_REMINDER_DAYS * DAY_MS) return null; // not due yet

  const inGracePeriod = now > periodEnd;
  const daysRemaining = Math.max(0, Math.ceil(((inGracePeriod ? graceEnd : periodEnd) - now) / DAY_MS));

  return { inGracePeriod, daysRemaining };
};
