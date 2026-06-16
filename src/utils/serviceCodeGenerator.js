/**
 * Service Code Generator utility
 * Generates 4-digit codes for recurring event occurrences
 */

export function generateServiceCode() {
  // Generate a random 4-digit code (1000-9999)
  return String(Math.floor(Math.random() * 9000) + 1000);
}

export function validateServiceCode(code) {
  // Check if code is a valid 4-digit number
  return /^\d{4}$/.test(String(code));
}
