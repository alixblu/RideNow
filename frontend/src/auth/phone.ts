/**
 * Phone validation for the mock sign-in. Spaces, dashes, and one leading `+` are
 * ignored; the rest must be only digits, 9 to 15 of them (Req 2.3, 2.4).
 */
export type PhoneResult = { ok: true; digits: string } | { ok: false; message: string };

export const PHONE_ERROR = "Enter a phone number with 9 to 15 digits.";

export function validatePhone(raw: string): PhoneResult {
  let value = raw.trim();
  if (value.startsWith("+")) value = value.slice(1);
  const digits = value.replace(/[ -]/g, "");
  if (/^\d{9,15}$/.test(digits)) return { ok: true, digits };
  return { ok: false, message: PHONE_ERROR };
}
