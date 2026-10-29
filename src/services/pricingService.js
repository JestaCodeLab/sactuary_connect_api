import PlanDiscount from '../models/PlanDiscount.js';
import { getAnnualPrice } from '../config/plans.js';

export const TAX_RATE = 0.1; // 10% platform tax

const DAY_MS = 24 * 60 * 60 * 1000;

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * End of a billing period starting at `from`. Single place for period length
 * so every code path (checkout, verify, renew, reactivate) agrees.
 */
export const addBillingPeriod = (from, billingCycle) => {
  const d = new Date(from);
  if (billingCycle === 'annual') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
};

/** List (undiscounted) price of a plan for a cycle. Null for custom-priced plans. */
export const getListPrice = (plan, billingCycle) => {
  if (!plan || plan.price == null) return null;
  if (plan.price === 0) return 0;
  return billingCycle === 'annual' ? getAnnualPrice(plan.price) : plan.price;
};

const discountAmountOff = (discount, listPrice) => {
  const off = discount.type === 'percent'
    ? listPrice * (Math.min(discount.value, 100) / 100)
    : discount.value;
  return round2(Math.min(Math.max(off, 0), listPrice));
};

/**
 * Best currently-active discount for a plan+cycle, as the one saving the most.
 * Discounts do not stack. Returns { discount, amountOff } or null.
 */
const pickBestDiscount = (discounts, planId, billingCycle, listPrice) => {
  let best = null;
  for (const d of discounts) {
    if (d.planId !== 'all' && d.planId !== planId) continue;
    if (d.billingCycle !== 'both' && d.billingCycle !== billingCycle) continue;
    const amountOff = discountAmountOff(d, listPrice);
    if (amountOff > 0 && (!best || amountOff > best.amountOff)) best = { discount: d, amountOff };
  }
  return best;
};

const loadActiveDiscounts = async (now = new Date()) =>
  PlanDiscount.find({
    isActive: true,
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $exists: false } }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $exists: false } }, { endsAt: { $gte: now } }] },
    ],
  }).lean();

const summarizeDiscount = (best) => best && ({
  id: best.discount._id.toString(),
  name: best.discount.name,
  type: best.discount.type,
  value: best.discount.value,
  amountOff: best.amountOff,
});

/**
 * Price of a plan for one cycle after the best active discount.
 * { listPrice, discount, price } - price is pre-tax, in the plan's currency.
 */
export const getPlanPricing = async (plan, billingCycle, { discounts } = {}) => {
  const listPrice = getListPrice(plan, billingCycle);
  if (listPrice == null) return { listPrice: null, discount: null, price: null };
  if (listPrice === 0) return { listPrice: 0, discount: null, price: 0 };

  const active = discounts || await loadActiveDiscounts();
  const best = pickBestDiscount(active, plan.id, billingCycle, listPrice);
  return {
    listPrice,
    discount: summarizeDiscount(best),
    price: round2(listPrice - (best?.amountOff || 0)),
  };
};

/** Decorate a plan for public display with monthly + annual pricing. */
export const withPricing = async (plan, opts = {}) => {
  const [monthly, annual] = await Promise.all([
    getPlanPricing(plan, 'monthly', opts),
    getPlanPricing(plan, 'annual', opts),
  ]);
  return {
    ...plan,
    effectiveMonthlyPrice: monthly.price,
    monthlyDiscount: monthly.discount,
    annualListPrice: annual.listPrice,
    annualPrice: annual.price,
    annualDiscount: annual.discount,
  };
};

export const withPricingForAll = async (plans) => {
  const discounts = await loadActiveDiscounts();
  return Promise.all(plans.map((p) => withPricing(p, { discounts })));
};

/**
 * Unused value of what the org already paid for the current period, as a
 * pre-tax credit. Only a completed, non-zero Paystack payment inside the
 * current period earns credit - superadmin-granted or free subscriptions
 * never do, so this can't be used to manufacture a discount.
 */
export const getProrationCredit = (subscription, now = new Date()) => {
  if (!subscription || subscription.status !== 'active') return 0;

  const start = new Date(subscription.currentPeriodStart).getTime();
  const end = new Date(subscription.currentPeriodEnd).getTime();
  const nowMs = now.getTime();
  if (!(end > start) || nowMs >= end) return 0;

  const paidAmount = subscription.priceAtSubscription?.amount || 0;
  if (paidAmount <= 0) return 0;

  const hasPaymentForPeriod = (subscription.paymentHistory || []).some(
    (p) => p.status === 'completed' && p.amount > 0 && p.paidAt
      && new Date(p.paidAt).getTime() >= start - DAY_MS
  );
  if (!hasPaymentForPeriod) return 0;

  const fractionLeft = Math.min(1, Math.max(0, (end - Math.max(nowMs, start)) / (end - start)));
  return round2(paidAmount * fractionLeft);
};

/**
 * Full server-side price quote for putting `subscription` on `plan`/`billingCycle`.
 * `total`/`totalPesewas` is what Paystack must charge. Throws nothing; callers
 * check `coveredByCredit` (net subtotal <= 0) before taking payment.
 */
export const buildQuote = async ({ subscription, plan, billingCycle }) => {
  const pricing = await getPlanPricing(plan, billingCycle);
  const credit = Math.min(getProrationCredit(subscription), pricing.price);
  const subtotal = round2(Math.max(0, pricing.price - credit));
  const taxAmount = round2(subtotal * TAX_RATE);
  const total = round2(subtotal + taxAmount);

  return {
    planId: plan.id,
    billingCycle,
    currency: plan.currency || 'GHS',
    listPrice: pricing.listPrice,
    discount: pricing.discount,
    price: pricing.price,
    credit,
    subtotal,
    taxRate: TAX_RATE,
    taxAmount,
    total,
    totalPesewas: Math.round(total * 100),
    coveredByCredit: subtotal <= 0,
    periodEnd: addBillingPeriod(new Date(), billingCycle),
  };
};
