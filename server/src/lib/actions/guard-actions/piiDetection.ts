/**
 * Alga Guard - PII Detection Engine
 *
 * Implements regex-based detection for various PII types with validation.
 * This module is designed to run both server-side and potentially in WASM.
 */

import type { GuardPiiType } from '@/interfaces/guard/pii.interfaces';
import {
  detectNamesAndAddresses,
  checkLlmNerHealth,
  type NerEntity,
} from '@/lib/services/llmNerService';

// ============================================================================
// Types
// ============================================================================

export interface PiiMatch {
  pii_type: GuardPiiType;
  matched_text: string;
  start_index: number;
  end_index: number;
  line_number: number;
  confidence: number;
  context?: string;
}

export interface PiiDetectionResult {
  matches: PiiMatch[];
  lines_scanned: number;
  processing_time_ms: number;
}

export interface PiiDetectorConfig {
  pii_types: GuardPiiType[];
  context_window?: number; // Characters of context to include around match
  max_matches_per_type?: number;
}

// ============================================================================
// Severity Weights (from PRD)
// ============================================================================

export const PII_SEVERITY_WEIGHTS: Record<GuardPiiType, number> = {
  ssn: 10,
  credit_card: 10,
  bank_account: 8,
  dob: 5,
  drivers_license: 5,
  passport: 5,
  phone: 2,
  email: 1,
  ip_address: 1,
  mac_address: 1,
  person_name: 3,  // F062: Name detection via LLM NER
  address: 4,      // F063: Address detection via LLM NER
};

// ============================================================================
// Regex Patterns
// ============================================================================

/**
 * SSN Pattern with negative lookaheads:
 * - Area cannot be 000, 666, or 900-999
 * - Group cannot be 00
 * - Serial cannot be 0000
 */
const SSN_PATTERN = /\b(?!000|666|9\d{2})\d{3}[- ]?(?!00)\d{2}[- ]?(?!0000)\d{4}\b/g;

/**
 * Credit Card Patterns
 */
const VISA_PATTERN = /\b4[0-9]{12}(?:[0-9]{3})?\b/g;
const MASTERCARD_PATTERN = /\b(?:5[1-5][0-9]{2}|222[1-9]|22[3-9][0-9]|2[3-6][0-9]{2}|27[01][0-9]|2720)[0-9]{12}\b/g;
const AMEX_PATTERN = /\b3[47][0-9]{13}\b/g;
const DISCOVER_PATTERN = /\b6(?:011|5[0-9]{2})[0-9]{12}\b/g;

/**
 * Bank Account Pattern (requires context matching)
 */
const BANK_ACCOUNT_PATTERN = /\b[0-9]{8,17}\b/g;
const BANK_CONTEXT_KEYWORDS = ['account', 'routing', 'aba', 'bank', 'checking', 'savings', 'wire', 'transfer'];

/**
 * Date of Birth Patterns
 */
const DOB_US_PATTERN = /\b(?:0[1-9]|1[0-2])[/\-.](?:0[1-9]|[12]\d|3[01])[/\-.](?:19|20)\d{2}\b/g;
const DOB_ISO_PATTERN = /\b(?:19|20)\d{2}[/\-.](?:0[1-9]|1[0-2])[/\-.](?:0[1-9]|[12]\d|3[01])\b/g;

/**
 * Driver's License Patterns by State
 */
const DL_PATTERNS: Record<string, RegExp> = {
  'AL': /\b\d{7}\b/g,
  'AK': /\b\d{7}\b/g,
  'AZ': /\b[A-Z]\d{8}\b/gi,
  'AR': /\b\d{9}\b/g,
  'CA': /\b[A-Z]\d{7}\b/gi,
  'CO': /\b\d{9}\b|[A-Z]{2}\d{3,6}\b/gi,
  'CT': /\b\d{9}\b/g,
  'DE': /\b\d{7}\b/g,
  'FL': /\b[A-Z]\d{12}\b/gi,
  'GA': /\b\d{9}\b/g,
  'HI': /\b[A-Z]\d{8}\b/gi,
  'ID': /\b[A-Z]{2}\d{6}[A-Z]\b/gi,
  'IL': /\b[A-Z]\d{11,12}\b/gi,
  'IN': /\b\d{10}\b|[A-Z]\d{9}\b/gi,
  'IA': /\b\d{9}|[A-Z]{3}\d{6}\b/gi,
  'KS': /\b[A-Z]\d{8}|K\d{8}\b/gi,
  'KY': /\b[A-Z]\d{8,9}\b/gi,
  'LA': /\b\d{9}\b/g,
  'ME': /\b\d{7}[A-Z]?\b/gi,
  'MD': /\b[A-Z]\d{12}\b/gi,
  'MA': /\bS\d{8}\b/gi,
  'MI': /\b[A-Z]\d{12}\b/gi,
  'MN': /\b[A-Z]\d{12}\b/gi,
  'MS': /\b\d{9}\b/g,
  'MO': /\b[A-Z]\d{5,9}\b|\d{9}\b/gi,
  'MT': /\b\d{13}|[A-Z]{9}\d{4}\b/gi,
  'NE': /\b[A-Z]\d{8}\b/gi,
  'NV': /\b\d{10,12}|X\d{8}\b/gi,
  'NH': /\b\d{2}[A-Z]{3}\d{5}\b/gi,
  'NJ': /\b[A-Z]\d{14}\b/gi,
  'NM': /\b\d{9}\b/g,
  'NY': /\b\d{9}\b/g,
  'NC': /\b\d{12}\b/g,
  'ND': /\b[A-Z]{3}\d{6}\b/gi,
  'OH': /\b[A-Z]{2}\d{6}\b/gi,
  'OK': /\b[A-Z]\d{9}\b/gi,
  'OR': /\b\d{7}\b/g,
  'PA': /\b\d{8}\b/g,
  'RI': /\b\d{7}|V\d{6}\b/gi,
  'SC': /\b\d{11}\b/g,
  'SD': /\b\d{8,10}\b/g,
  'TN': /\b\d{7,9}\b/g,
  'TX': /\b\d{8}\b/g,
  'UT': /\b\d{4,10}\b/g,
  'VT': /\b\d{8}|[A-Z]{7}\d\b/gi,
  'VA': /\b[A-Z]\d{8,11}\b/gi,
  'WA': /\b[A-Z]{5}[A-Z0-9]{7}\b/gi,
  'WV': /\b[A-Z]{1,2}\d{5,6}\b/gi,
  'WI': /\b[A-Z]\d{13}\b/gi,
  'WY': /\b\d{9,10}\b/g,
  'DC': /\b\d{7}\b/g,
};

const DL_CONTEXT_KEYWORDS = ['license', 'licence', 'dl', 'driver', 'driving', 'dmv', 'id'];

/**
 * Passport Pattern (requires context matching)
 */
const PASSPORT_PATTERN = /\b[A-Z]{1,2}\d{6,9}\b/gi;
const PASSPORT_CONTEXT_KEYWORDS = ['passport', 'travel', 'document', 'visa'];

/**
 * Contact Information Patterns
 */
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_US_PATTERN = /\b(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
const PHONE_INTL_PATTERN = /\b\+[1-9]\d{6,14}\b/g;

/**
 * Network Identifiers
 */
const IPV4_PATTERN = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g;
const IPV6_FULL_PATTERN = /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/gi;
const IPV6_COMPRESSED_PATTERN = /\b(?:[0-9a-fA-F]{1,4}:)*:(?:[0-9a-fA-F]{1,4}:)*[0-9a-fA-F]{1,4}\b/gi;
const MAC_ADDRESS_PATTERN = /\b([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g;

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Luhn algorithm for credit card validation
 */
export function luhnCheck(cardNumber: string): boolean {
  const digits = cardNumber.replace(/\D/g, '').split('').map(Number);
  let sum = 0;
  let isEven = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = digits[i];
    if (isEven) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    isEven = !isEven;
  }

  return sum % 10 === 0;
}

/**
 * Validate SSN structure (additional checks beyond regex)
 */
export function validateSSN(ssn: string): boolean {
  const cleaned = ssn.replace(/[-\s]/g, '');
  if (cleaned.length !== 9) return false;

  const area = parseInt(cleaned.substring(0, 3), 10);
  const group = parseInt(cleaned.substring(3, 5), 10);
  const serial = parseInt(cleaned.substring(5, 9), 10);

  // Additional validation rules
  if (area === 0 || area === 666 || area >= 900) return false;
  if (group === 0) return false;
  if (serial === 0) return false;

  return true;
}

/**
 * Validate date is a reasonable DOB (not in future, not too old)
 */
export function validateDOB(dateStr: string): boolean {
  const cleaned = dateStr.replace(/[/\-.]/g, '-');
  const parts = cleaned.split('-');

  let year: number, month: number, day: number;

  // Detect format (US: MM-DD-YYYY or ISO: YYYY-MM-DD)
  if (parts[0].length === 4) {
    // ISO format
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    day = parseInt(parts[2], 10);
  } else {
    // US format
    month = parseInt(parts[0], 10);
    day = parseInt(parts[1], 10);
    year = parseInt(parts[2], 10);
  }

  const date = new Date(year, month - 1, day);
  const now = new Date();
  const minDate = new Date(1900, 0, 1);

  // Check if date is valid and reasonable
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return false;
  }

  return date <= now && date >= minDate;
}

/**
 * Check if context contains relevant keywords
 */
export function hasContextKeywords(text: string, keywords: string[]): boolean {
  const lowerText = text.toLowerCase();
  return keywords.some(keyword => lowerText.includes(keyword.toLowerCase()));
}

/**
 * Validate email TLD
 */
export function validateEmail(email: string): boolean {
  const tldPart = email.split('.').pop()?.toLowerCase();
  if (!tldPart) return false;

  // Basic TLD validation - must be 2-6 characters
  // We accept any valid-looking TLD since new TLDs are added regularly
  return tldPart.length >= 2 && tldPart.length <= 6;
}

/**
 * Validate IPv4 address (not private/reserved)
 */
export function validatePublicIPv4(ip: string): boolean {
  const octets = ip.split('.').map(Number);

  // Private ranges: 10.x.x.x, 172.16-31.x.x, 192.168.x.x
  if (octets[0] === 10) return false;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return false;
  if (octets[0] === 192 && octets[1] === 168) return false;

  // Loopback: 127.x.x.x
  if (octets[0] === 127) return false;

  // Link-local: 169.254.x.x
  if (octets[0] === 169 && octets[1] === 254) return false;

  return true;
}

// ============================================================================
// Detection Engine
// ============================================================================

/**
 * Get line number from character index
 */
function getLineNumber(text: string, index: number): number {
  const substring = text.substring(0, index);
  return (substring.match(/\n/g) || []).length + 1;
}

/**
 * Extract context around a match
 */
function extractContext(text: string, startIndex: number, endIndex: number, windowSize: number = 50): string {
  const contextStart = Math.max(0, startIndex - windowSize);
  const contextEnd = Math.min(text.length, endIndex + windowSize);
  return text.substring(contextStart, contextEnd);
}

/**
 * Detect SSN matches
 */
function detectSSN(text: string, contextWindow: number): PiiMatch[] {
  const matches: PiiMatch[] = [];
  const regex = new RegExp(SSN_PATTERN.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (validateSSN(match[0])) {
      matches.push({
        pii_type: 'ssn',
        matched_text: match[0],
        start_index: match.index,
        end_index: match.index + match[0].length,
        line_number: getLineNumber(text, match.index),
        confidence: 0.95,
        context: extractContext(text, match.index, match.index + match[0].length, contextWindow),
      });
    }
  }

  return matches;
}

/**
 * Detect credit card matches (all card types)
 */
function detectCreditCard(text: string, contextWindow: number): PiiMatch[] {
  const matches: PiiMatch[] = [];

  const cardPatterns = [
    { pattern: VISA_PATTERN, name: 'Visa' },
    { pattern: MASTERCARD_PATTERN, name: 'Mastercard' },
    { pattern: AMEX_PATTERN, name: 'Amex' },
    { pattern: DISCOVER_PATTERN, name: 'Discover' },
  ];

  for (const { pattern } of cardPatterns) {
    const regex = new RegExp(pattern.source, 'g');
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      if (luhnCheck(match[0])) {
        matches.push({
          pii_type: 'credit_card',
          matched_text: match[0],
          start_index: match.index,
          end_index: match.index + match[0].length,
          line_number: getLineNumber(text, match.index),
          confidence: 0.98,
          context: extractContext(text, match.index, match.index + match[0].length, contextWindow),
        });
      }
    }
  }

  return matches;
}

/**
 * Detect bank account matches (requires context)
 */
function detectBankAccount(text: string, contextWindow: number): PiiMatch[] {
  const matches: PiiMatch[] = [];
  const regex = new RegExp(BANK_ACCOUNT_PATTERN.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const context = extractContext(text, match.index, match.index + match[0].length, 100);

    if (hasContextKeywords(context, BANK_CONTEXT_KEYWORDS)) {
      matches.push({
        pii_type: 'bank_account',
        matched_text: match[0],
        start_index: match.index,
        end_index: match.index + match[0].length,
        line_number: getLineNumber(text, match.index),
        confidence: 0.75,
        context: extractContext(text, match.index, match.index + match[0].length, contextWindow),
      });
    }
  }

  return matches;
}

/**
 * Detect date of birth matches
 */
function detectDOB(text: string, contextWindow: number): PiiMatch[] {
  const matches: PiiMatch[] = [];

  const patterns = [DOB_US_PATTERN, DOB_ISO_PATTERN];

  for (const pattern of patterns) {
    const regex = new RegExp(pattern.source, 'g');
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      if (validateDOB(match[0])) {
        matches.push({
          pii_type: 'dob',
          matched_text: match[0],
          start_index: match.index,
          end_index: match.index + match[0].length,
          line_number: getLineNumber(text, match.index),
          confidence: 0.7,
          context: extractContext(text, match.index, match.index + match[0].length, contextWindow),
        });
      }
    }
  }

  return matches;
}

/**
 * Detect driver's license matches (requires context)
 */
function detectDriversLicense(text: string, contextWindow: number): PiiMatch[] {
  const matches: PiiMatch[] = [];

  // Try all state patterns
  for (const [state, pattern] of Object.entries(DL_PATTERNS)) {
    const regex = new RegExp(pattern.source, 'gi');
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const context = extractContext(text, match.index, match.index + match[0].length, 100);

      // Require context keywords or state abbreviation
      if (hasContextKeywords(context, DL_CONTEXT_KEYWORDS) ||
          context.toUpperCase().includes(state)) {
        matches.push({
          pii_type: 'drivers_license',
          matched_text: match[0],
          start_index: match.index,
          end_index: match.index + match[0].length,
          line_number: getLineNumber(text, match.index),
          confidence: 0.7,
          context: extractContext(text, match.index, match.index + match[0].length, contextWindow),
        });
      }
    }
  }

  // Deduplicate matches that overlap
  return deduplicateMatches(matches);
}

/**
 * Detect passport matches (requires context)
 */
function detectPassport(text: string, contextWindow: number): PiiMatch[] {
  const matches: PiiMatch[] = [];
  const regex = new RegExp(PASSPORT_PATTERN.source, 'gi');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const context = extractContext(text, match.index, match.index + match[0].length, 100);

    if (hasContextKeywords(context, PASSPORT_CONTEXT_KEYWORDS)) {
      matches.push({
        pii_type: 'passport',
        matched_text: match[0],
        start_index: match.index,
        end_index: match.index + match[0].length,
        line_number: getLineNumber(text, match.index),
        confidence: 0.75,
        context: extractContext(text, match.index, match.index + match[0].length, contextWindow),
      });
    }
  }

  return matches;
}

/**
 * Detect email matches
 */
function detectEmail(text: string, contextWindow: number): PiiMatch[] {
  const matches: PiiMatch[] = [];
  const regex = new RegExp(EMAIL_PATTERN.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (validateEmail(match[0])) {
      matches.push({
        pii_type: 'email',
        matched_text: match[0],
        start_index: match.index,
        end_index: match.index + match[0].length,
        line_number: getLineNumber(text, match.index),
        confidence: 0.95,
        context: extractContext(text, match.index, match.index + match[0].length, contextWindow),
      });
    }
  }

  return matches;
}

/**
 * Detect phone number matches
 */
function detectPhone(text: string, contextWindow: number): PiiMatch[] {
  const matches: PiiMatch[] = [];

  const patterns = [PHONE_US_PATTERN, PHONE_INTL_PATTERN];

  for (const pattern of patterns) {
    const regex = new RegExp(pattern.source, 'g');
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      matches.push({
        pii_type: 'phone',
        matched_text: match[0],
        start_index: match.index,
        end_index: match.index + match[0].length,
        line_number: getLineNumber(text, match.index),
        confidence: 0.85,
        context: extractContext(text, match.index, match.index + match[0].length, contextWindow),
      });
    }
  }

  return deduplicateMatches(matches);
}

/**
 * Detect IP address matches
 */
function detectIPAddress(text: string, contextWindow: number): PiiMatch[] {
  const matches: PiiMatch[] = [];

  // IPv4
  const ipv4Regex = new RegExp(IPV4_PATTERN.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = ipv4Regex.exec(text)) !== null) {
    matches.push({
      pii_type: 'ip_address',
      matched_text: match[0],
      start_index: match.index,
      end_index: match.index + match[0].length,
      line_number: getLineNumber(text, match.index),
      confidence: validatePublicIPv4(match[0]) ? 0.9 : 0.6,
      context: extractContext(text, match.index, match.index + match[0].length, contextWindow),
    });
  }

  // IPv6 (full)
  const ipv6FullRegex = new RegExp(IPV6_FULL_PATTERN.source, 'gi');
  while ((match = ipv6FullRegex.exec(text)) !== null) {
    matches.push({
      pii_type: 'ip_address',
      matched_text: match[0],
      start_index: match.index,
      end_index: match.index + match[0].length,
      line_number: getLineNumber(text, match.index),
      confidence: 0.85,
      context: extractContext(text, match.index, match.index + match[0].length, contextWindow),
    });
  }

  // IPv6 (compressed)
  const ipv6CompressedRegex = new RegExp(IPV6_COMPRESSED_PATTERN.source, 'gi');
  while ((match = ipv6CompressedRegex.exec(text)) !== null) {
    matches.push({
      pii_type: 'ip_address',
      matched_text: match[0],
      start_index: match.index,
      end_index: match.index + match[0].length,
      line_number: getLineNumber(text, match.index),
      confidence: 0.8,
      context: extractContext(text, match.index, match.index + match[0].length, contextWindow),
    });
  }

  return deduplicateMatches(matches);
}

/**
 * Detect MAC address matches
 */
function detectMACAddress(text: string, contextWindow: number): PiiMatch[] {
  const matches: PiiMatch[] = [];
  const regex = new RegExp(MAC_ADDRESS_PATTERN.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    matches.push({
      pii_type: 'mac_address',
      matched_text: match[0],
      start_index: match.index,
      end_index: match.index + match[0].length,
      line_number: getLineNumber(text, match.index),
      confidence: 0.9,
      context: extractContext(text, match.index, match.index + match[0].length, contextWindow),
    });
  }

  return matches;
}

/**
 * Remove duplicate matches that overlap
 */
function deduplicateMatches(matches: PiiMatch[]): PiiMatch[] {
  if (matches.length <= 1) return matches;

  // Sort by start index
  const sorted = [...matches].sort((a, b) => a.start_index - b.start_index);
  const result: PiiMatch[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = result[result.length - 1];

    // If current match doesn't overlap with the last one, add it
    if (current.start_index >= last.end_index) {
      result.push(current);
    } else if (current.confidence > last.confidence) {
      // If overlapping and current has higher confidence, replace
      result[result.length - 1] = current;
    }
  }

  return result;
}

// ============================================================================
// Main Detection Function
// ============================================================================

// Sync detectors for regex-based PII types
const SYNC_DETECTORS: Partial<Record<GuardPiiType, (text: string, contextWindow: number) => PiiMatch[]>> = {
  ssn: detectSSN,
  credit_card: detectCreditCard,
  bank_account: detectBankAccount,
  dob: detectDOB,
  drivers_license: detectDriversLicense,
  passport: detectPassport,
  email: detectEmail,
  phone: detectPhone,
  ip_address: detectIPAddress,
  mac_address: detectMACAddress,
  // person_name and address use LLM NER (async) - see detectPIIAsync
};

// PII types that require LLM NER (async detection)
const LLM_NER_TYPES: GuardPiiType[] = ['person_name', 'address'];

/**
 * Synchronous PII detection (regex-based types only)
 *
 * Use this for quick scanning of structured PII like SSN, credit cards, etc.
 * Does NOT detect names or addresses - use detectPIIAsync for full detection.
 *
 * @param text - The text content to scan
 * @param config - Detection configuration
 * @returns Detection results with matches
 */
export function detectPII(text: string, config: PiiDetectorConfig): PiiDetectionResult {
  const startTime = Date.now();
  const contextWindow = config.context_window ?? 50;
  const maxMatchesPerType = config.max_matches_per_type ?? 1000;

  const allMatches: PiiMatch[] = [];

  for (const piiType of config.pii_types) {
    // Skip LLM NER types in sync detection
    if (LLM_NER_TYPES.includes(piiType)) {
      continue;
    }

    const detector = SYNC_DETECTORS[piiType];
    if (detector) {
      const typeMatches = detector(text, contextWindow);

      // Limit matches per type to avoid overwhelming results
      const limitedMatches = typeMatches.slice(0, maxMatchesPerType);
      allMatches.push(...limitedMatches);
    }
  }

  // Sort all matches by line number, then start index
  allMatches.sort((a, b) => {
    if (a.line_number !== b.line_number) {
      return a.line_number - b.line_number;
    }
    return a.start_index - b.start_index;
  });

  const linesScanned = (text.match(/\n/g) || []).length + 1;

  return {
    matches: allMatches,
    lines_scanned: linesScanned,
    processing_time_ms: Date.now() - startTime,
  };
}

/**
 * Async PII detection with LLM NER support (F062, F063)
 *
 * Detects all PII types including names and addresses using local LLM.
 * Use this for comprehensive PII detection.
 *
 * @param text - The text content to scan
 * @param config - Detection configuration
 * @returns Detection results with all matches including LLM NER results
 */
export async function detectPIIAsync(text: string, config: PiiDetectorConfig): Promise<PiiDetectionResult> {
  const startTime = Date.now();
  const contextWindow = config.context_window ?? 50;
  const maxMatchesPerType = config.max_matches_per_type ?? 1000;

  // Start with sync detection for regex-based types
  const syncResult = detectPII(text, config);
  const allMatches: PiiMatch[] = [...syncResult.matches];

  // Check if we need LLM NER detection
  const needsPersonName = config.pii_types.includes('person_name');
  const needsAddress = config.pii_types.includes('address');

  if (needsPersonName || needsAddress) {
    try {
      // Call LLM NER service for names and addresses
      const nerResult = await detectNamesAndAddresses(text);

      // Convert NER entities to PiiMatches
      if (needsPersonName) {
        const nameMatches = nerResult.names
          .slice(0, maxMatchesPerType)
          .map((entity) => nerEntityToPiiMatch(entity, 'person_name', text, contextWindow));
        allMatches.push(...nameMatches);
      }

      if (needsAddress) {
        const addressMatches = nerResult.addresses
          .slice(0, maxMatchesPerType)
          .map((entity) => nerEntityToPiiMatch(entity, 'address', text, contextWindow));
        allMatches.push(...addressMatches);
      }
    } catch (error) {
      // Log error but don't fail - return what we have from sync detection
      console.error('LLM NER detection failed:', error);
    }
  }

  // Sort all matches by line number, then start index
  allMatches.sort((a, b) => {
    if (a.line_number !== b.line_number) {
      return a.line_number - b.line_number;
    }
    return a.start_index - b.start_index;
  });

  return {
    matches: allMatches,
    lines_scanned: syncResult.lines_scanned,
    processing_time_ms: Date.now() - startTime,
  };
}

/**
 * Convert NER entity to PiiMatch
 */
function nerEntityToPiiMatch(
  entity: NerEntity,
  piiType: GuardPiiType,
  text: string,
  contextWindow: number
): PiiMatch {
  return {
    pii_type: piiType,
    matched_text: entity.text,
    start_index: entity.start_index,
    end_index: entity.end_index,
    line_number: getLineNumber(text, entity.start_index),
    confidence: entity.confidence,
    context: extractContext(text, entity.start_index, entity.end_index, contextWindow),
  };
}

/**
 * Check if LLM NER service is available
 */
export { checkLlmNerHealth };

/**
 * Redact matched text for display purposes
 * Shows first and last 2 characters with asterisks in between
 */
export function redactMatch(matchedText: string): string {
  if (matchedText.length <= 4) {
    return '*'.repeat(matchedText.length);
  }

  const prefix = matchedText.substring(0, 2);
  const suffix = matchedText.substring(matchedText.length - 2);
  const middle = '*'.repeat(matchedText.length - 4);

  return prefix + middle + suffix;
}

/**
 * Get severity level for a PII type
 */
export function getSeverityLevel(piiType: GuardPiiType): 'high' | 'medium' | 'low' {
  const weight = PII_SEVERITY_WEIGHTS[piiType];
  if (weight >= 8) return 'high';
  if (weight >= 5) return 'medium';
  return 'low';
}
