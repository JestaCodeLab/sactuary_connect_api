/**
 * Utility functions to compute occurrence dates for recurring events.
 *
 * A recurring event has:
 *   - startDate / endDate: anchor for the first occurrence (defines time-of-day + duration)
 *   - recurrencePattern: 'weekly' | 'biweekly' | 'monthly'
 *   - recurrenceDay: 0-6 (Sunday-Saturday)
 *   - recurrenceEndDate: when the series ends (optional)
 */

/**
 * Compute all occurrences of a recurring event within a date range.
 * Returns [{ startDate: Date, endDate: Date }].
 */
export function computeOccurrences(event, rangeStart, rangeEnd) {
  if (!event.isRecurring || !event.recurrencePattern) return [];

  const anchorStart = new Date(event.startDate);
  const duration = new Date(event.endDate).getTime() - anchorStart.getTime();
  const seriesEnd = event.recurrenceEndDate ? new Date(event.recurrenceEndDate) : null;
  const from = new Date(rangeStart);
  const to = new Date(rangeEnd);

  const occurrences = [];

  // Start from the anchor and find the first occurrence of the correct day
  let current = new Date(anchorStart);
  if (event.recurrenceDay !== undefined && event.recurrenceDay !== null) {
    while (current.getDay() !== event.recurrenceDay) {
      current.setDate(current.getDate() + 1);
    }
    // Preserve the time from the anchor
    current.setHours(anchorStart.getHours(), anchorStart.getMinutes(), anchorStart.getSeconds(), anchorStart.getMilliseconds());
  }

  const increment = getIncrement(event.recurrencePattern);

  while (current <= to) {
    if (seriesEnd && current > seriesEnd) break;

    if (current >= from) {
      const occStart = new Date(current);
      const occEnd = new Date(occStart.getTime() + duration);
      occurrences.push({ startDate: occStart, endDate: occEnd });
    }

    advanceDate(current, event.recurrencePattern, increment);
  }

  return occurrences;
}

/**
 * Get the next occurrence on or after `fromDate`. Returns { startDate, endDate } or null.
 */
export function getNextOccurrence(event, fromDate = new Date()) {
  if (!event.isRecurring || !event.recurrencePattern) return null;

  const anchorStart = new Date(event.startDate);
  const duration = new Date(event.endDate).getTime() - anchorStart.getTime();
  const seriesEnd = event.recurrenceEndDate ? new Date(event.recurrenceEndDate) : null;
  const from = new Date(fromDate);

  let current = new Date(anchorStart);
  if (event.recurrenceDay !== undefined && event.recurrenceDay !== null) {
    while (current.getDay() !== event.recurrenceDay) {
      current.setDate(current.getDate() + 1);
    }
    current.setHours(anchorStart.getHours(), anchorStart.getMinutes(), anchorStart.getSeconds(), anchorStart.getMilliseconds());
  }

  const increment = getIncrement(event.recurrencePattern);

  // Fast-forward to near the target date
  while (current < from) {
    const occEnd = new Date(current.getTime() + duration);
    // If the occurrence is currently ongoing, return it
    if (occEnd >= from) {
      break;
    }
    advanceDate(current, event.recurrencePattern, increment);
  }

  if (seriesEnd && current > seriesEnd) return null;

  const occStart = new Date(current);
  const occEnd = new Date(occStart.getTime() + duration);
  return { startDate: occStart, endDate: occEnd };
}

/**
 * The most recent occurrence that has already started on or before `from`
 * (whether or not it has finished). Returns { startDate, endDate } or null
 * when the series hasn't started yet.
 */
export function getPreviousOccurrence(event, from = new Date()) {
  if (!event.isRecurring || !event.recurrencePattern) return null;

  const anchorStart = new Date(event.startDate);
  const duration = new Date(event.endDate).getTime() - anchorStart.getTime();
  const seriesEnd = event.recurrenceEndDate ? new Date(event.recurrenceEndDate) : null;
  const limit = new Date(from);

  let current = new Date(anchorStart);
  if (event.recurrenceDay !== undefined && event.recurrenceDay !== null) {
    while (current.getDay() !== event.recurrenceDay) {
      current.setDate(current.getDate() + 1);
    }
    current.setHours(anchorStart.getHours(), anchorStart.getMinutes(), anchorStart.getSeconds(), anchorStart.getMilliseconds());
  }

  if (current > limit) return null; // series starts in the future

  const increment = getIncrement(event.recurrencePattern);

  let latest = null;
  while (current <= limit) {
    if (seriesEnd && current > seriesEnd) break;
    latest = new Date(current);
    advanceDate(current, event.recurrencePattern, increment);
  }

  if (!latest) return null;
  return { startDate: latest, endDate: new Date(latest.getTime() + duration) };
}

/**
 * The occurrence a check-in happening *now* should be attributed to: the one
 * currently in progress, else whichever neighbouring occurrence is nearest in
 * time.
 *
 * "Nearest" matters in both directions and is why this isn't simply
 * next-occurrence or previous-occurrence:
 *   - Someone checked in 20 minutes before doors open belongs to the service
 *     about to start (people arrive early).
 *   - Someone checked in an hour after the service ended belongs to the
 *     service that just finished, NOT to next week's.
 * The old `getCurrentOccurrence() || getNextOccurrence()` always chose the
 * future occurrence in that second case, which silently stamped real
 * attendance onto dates that hadn't happened yet.
 *
 * Comparing distances rather than using a fixed grace window means this
 * scales correctly for any recurrence gap (weekly, biweekly, monthly).
 */
export function getOccurrenceForCheckIn(event, now = new Date()) {
  if (!event.isRecurring || !event.recurrencePattern) return null;

  const current = getCurrentOccurrence(event, now);
  if (current) return current;

  const previous = getPreviousOccurrence(event, now);
  const next = getNextOccurrence(event, now);

  if (!previous) return next || null; // series hasn't started yet
  if (!next) return previous;         // series has ended

  const sincePreviousEnded = now.getTime() - previous.endDate.getTime();
  const untilNextStarts = next.startDate.getTime() - now.getTime();

  return untilNextStarts < sincePreviousEnded ? next : previous;
}

/**
 * Finds the occurrence of `event` whose start matches `date`, or null if
 * `date` isn't actually a scheduled occurrence of the series. Used to
 * validate client-supplied occurrence dates before they're persisted.
 */
export function findOccurrenceByDate(event, date) {
  if (!event.isRecurring || !event.recurrencePattern) return null;

  const target = new Date(date);
  if (isNaN(target.getTime())) return null;

  // Search a window around the target so a date that lands mid-series is
  // found regardless of how far it is from the anchor.
  const windowStart = new Date(target.getTime() - 24 * 60 * 60 * 1000);
  const windowEnd = new Date(target.getTime() + 24 * 60 * 60 * 1000);

  return computeOccurrences(event, windowStart, windowEnd)
    .find((occ) => occ.startDate.getTime() === target.getTime()) || null;
}

/**
 * Get the occurrence that is currently ongoing, or null.
 */
export function getCurrentOccurrence(event, now = new Date()) {
  const next = getNextOccurrence(event, now);
  if (!next) return null;

  // Check if we're within this occurrence's time window
  if (now >= next.startDate && now <= next.endDate) {
    return next;
  }

  return null;
}

function getIncrement(pattern) {
  return pattern === 'weekly' ? 7 : pattern === 'biweekly' ? 14 : 30;
}

function advanceDate(date, pattern, increment) {
  if (pattern === 'monthly') {
    date.setMonth(date.getMonth() + 1);
  } else {
    date.setDate(date.getDate() + increment);
  }
}
