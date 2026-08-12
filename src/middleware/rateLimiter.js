import rateLimit from 'express-rate-limit';

/**
 * Rate limiter for public, unauthenticated event check-in endpoints
 * (QR/service-code lookup, member search, guest/member check-in submission).
 *
 * These routes have no auth to gate them, and service codes are only a 4-digit
 * keyspace (9000 possibilities) - without a limiter here they're brute-forceable.
 */
export const publicCheckInLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // generous for a real person scanning/searching/submitting, tight for brute-forcing service codes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again in a few minutes.' },
});
