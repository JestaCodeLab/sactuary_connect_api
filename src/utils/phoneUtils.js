/**
 * Normalize a phone number by stripping spaces, dashes, and parentheses.
 * Preserves the leading + if present.
 *
 * @param {string} phone
 * @returns {string}
 */
export function normalizePhone(phone) {
  if (!phone) return '';
  return phone.replace(/[\s\-\(\)\.]/g, '').trim();
}

/**
 * Extract the local digits from a phone number (last 9 digits).
 * This allows matching between formats like +233557228597 and 0557228597.
 *
 * @param {string} phone
 * @returns {string}
 */
export function getLocalDigits(phone) {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  // Drop leading zero for local format
  const withoutLeadingZero = digits.startsWith('0') ? digits.substring(1) : digits;
  // Take last 9 digits (covers most country formats)
  return withoutLeadingZero.length > 9
    ? withoutLeadingZero.slice(-9)
    : withoutLeadingZero;
}

/**
 * Find a member by phone number, trying exact match first then local-digits suffix match.
 *
 * @param {import('mongoose').Model} Member
 * @param {string} phone
 * @param {string} organizationId
 * @returns {Promise<Object|null>}
 */
export async function findMemberByPhone(Member, phone, organizationId) {
  if (!phone) return null;

  const normalized = normalizePhone(phone);

  // Try exact match first
  let member = await Member.findOne({
    phone: normalized,
    organizationId,
  });

  if (member) return member;

  // Try suffix match using local digits (handles +233xxx vs 0xxx)
  const localDigits = getLocalDigits(phone);
  if (localDigits.length >= 7) {
    member = await Member.findOne({
      organizationId,
      phone: { $regex: localDigits + '$' },
    });
  }

  return member;
}
