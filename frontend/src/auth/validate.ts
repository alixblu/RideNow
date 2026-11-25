/**
 * Pure field validators for the sign-in and sign-up forms (Req 3.6).
 * Each returns `null` when valid, or the offending field with an inline message.
 */
export type AuthField = "email" | "password" | "fullName";

export interface FieldError {
  field: AuthField;
  message: string;
}

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

// Pragmatic shape check: local@domain.tld with no whitespace.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): FieldError | null {
  const value = email.trim();
  if (value.length === 0) {
    return { field: "email", message: "Enter your email address." };
  }
  if (!EMAIL_PATTERN.test(value)) {
    return { field: "email", message: "Enter a valid email address." };
  }
  return null;
}

export function validatePassword(password: string): FieldError | null {
  if (password.length === 0) {
    return { field: "password", message: "Enter your password." };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      field: "password",
      message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return {
      field: "password",
      message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`,
    };
  }
  return null;
}

export function validateFullName(fullName: string): FieldError | null {
  if (fullName.trim().length === 0) {
    return { field: "fullName", message: "Enter your full name." };
  }
  return null;
}
