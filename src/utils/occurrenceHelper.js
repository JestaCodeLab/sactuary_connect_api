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
