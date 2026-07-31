/**
 * Password policy validation for @alga-psa/validation.
 *
 * Single source of truth for password rules, shared by every password-setting flow
 * (registration, admin user creation, portal setup, password reset, change password)
 * and by the server-side Zod `passwordSchema`. Kept separate from the form-field
 * validators (name/email/address/postal/etc.) because passwords are an auth concern,
 * not a client/contact form concern.
 */

// Common base words that stay weak even when decorated with numbers/symbols
// (e.g. "Welcome1!", "Password123"). Compared against a normalized core, not verbatim.
const COMMON_PASSWORD_BASES = [
  'password', 'qwerty', 'admin', 'letmein', 'welcome', 'iloveyou',
  'monkey', 'dragon', 'sunshine', 'princess', 'login', 'master',
  'football', 'baseball', 'superman', 'starwars', 'whatever', 'secret',
];

// Longest run of characters ascending/descending by one within the same class
// (digits or letters), e.g. "1234" -> 4, "fedc" -> 4.
function longestMonotonicRun(s: string): number {
  let best = 1;
  let run = 1;
  for (let i = 1; i < s.length; i++) {
    const bothDigits = s[i - 1] >= '0' && s[i - 1] <= '9' && s[i] >= '0' && s[i] <= '9';
    const bothLetters = s[i - 1] >= 'a' && s[i - 1] <= 'z' && s[i] >= 'a' && s[i] <= 'z';
    const diff = s.charCodeAt(i) - s.charCodeAt(i - 1);
    if ((bothDigits || bothLetters) && (diff === 1 || diff === -1)) {
      run = run >= 2 && s.charCodeAt(i - 1) - s.charCodeAt(i - 2) === diff ? run + 1 : 2;
    } else {
      run = 1;
    }
    if (run > best) best = run;
  }
  return best;
}

// Longest run that walks along a keyboard row, e.g. "qwerty" -> 6, "asdf" -> 4
// (forwards or backwards).
function longestKeyboardRun(s: string): number {
  const rows = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  const sequences = rows.flatMap((row) => [row, [...row].reverse().join('')]);
  let best = 0;
  for (const seq of sequences) {
    for (let i = 0; i < s.length; i++) {
      let len = 0;
      while (i + len < s.length && seq.includes(s.slice(i, i + len + 1))) len++;
      if (len > best) best = len;
    }
  }
  return best;
}

// A password is only rejected for sequences when a single run is long enough to
// dominate it (>= 6 chars), so incidental fragments like "...1234" are allowed.
const SEQUENTIAL_RUN_LIMIT = 6;
function hasLongSequentialRun(password: string): boolean {
  const lower = password.toLowerCase();
  return Math.max(longestMonotonicRun(lower), longestKeyboardRun(lower)) >= SEQUENTIAL_RUN_LIMIT;
}

// Password validation with enterprise security standards
export function validatePassword(password: string): string | null {
  if (!password) {
    return 'Password is required';
  }

  // Check minimum length (8 characters)
  if (password.length < 8) {
    return 'Password must be at least 8 characters long';
  }

  // Check maximum length (to prevent DoS attacks)
  if (password.length > 128) {
    return 'Password must be 128 characters or less';
  }

  // Check for uppercase letter
  if (!/[A-Z]/.test(password)) {
    return 'Password must contain at least one uppercase letter';
  }

  // Check for lowercase letter
  if (!/[a-z]/.test(password)) {
    return 'Password must contain at least one lowercase letter';
  }

  // Check for number
  if (!/\d/.test(password)) {
    return 'Password must contain at least one number';
  }

  // Check for special character
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return 'Password must contain at least one special character';
  }

  // Reject common base words even when decorated with numbers/symbols
  // (e.g. "Welcome1!", "Password123"). Strip leading/trailing non-letters to a core,
  // then compare against the blocklist. (Note: this does not yet undo leetspeak such
  // as "P@ssw0rd"; that is a known follow-up.)
  const normalizedCore = password.toLowerCase().replace(/^[^a-z]+/, '').replace(/[^a-z]+$/, '');
  if (COMMON_PASSWORD_BASES.includes(normalizedCore)) {
    return 'Password is too common. Please choose a stronger password';
  }

  // Reject only sequences long enough to dominate the password (e.g. "123456",
  // "qwerty", "abcdef"); an incidental tail like "...1234" is allowed.
  if (hasLongSequentialRun(password)) {
    return 'Password cannot contain sequential characters';
  }

  return null;
}

// Get password requirements for display
export function getPasswordRequirements(password: string) {
  return {
    minLength: password.length >= 8,
    hasUpper: /[A-Z]/.test(password),
    hasLower: /[a-z]/.test(password),
    hasNumber: /\d/.test(password),
    hasSpecial: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)
  };
}
