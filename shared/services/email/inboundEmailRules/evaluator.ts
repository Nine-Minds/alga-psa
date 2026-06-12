/**
 * Pure condition/extraction evaluation for inbound email rules.
 * No database access — the same functions back production processing and the
 * settings-UI live tester.
 */

import { extractEmailDomain, normalizeEmailAddress } from '../../../lib/email/addressUtils';
import type {
  ExtractAssignClientActionConfig,
  InboundEmailExtraction,
  InboundEmailRuleCondition,
  InboundEmailRuleConditionResult,
  InboundEmailRuleEmailInput,
} from './types';

export const MAX_REGEX_PATTERN_LENGTH = 512;
export const MAX_BODY_TEXT_LENGTH = 100_000;

/** Invalid patterns are logged once per pattern per process, not once per email. */
const reportedInvalidPatterns = new Set<string>();

function compileRulePattern(pattern: string, context: string): RegExp | null {
  if (typeof pattern !== 'string' || !pattern || pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    return null;
  }

  try {
    return new RegExp(pattern, 'i');
  } catch {
    if (!reportedInvalidPatterns.has(pattern)) {
      reportedInvalidPatterns.add(pattern);
      console.warn(`inboundEmailRules: invalid regex pattern (treated as non-matching) in ${context}`, {
        pattern: pattern.slice(0, 100),
      });
    }
    return null;
  }
}

export function buildRuleEmailInput(emailData: {
  from?: { email?: string };
  to?: Array<{ email?: string }>;
  cc?: Array<{ email?: string }>;
  subject?: string;
  body?: { text?: string; html?: string };
}): InboundEmailRuleEmailInput {
  const fromAddress = normalizeEmailAddress(emailData.from?.email) ?? '';
  const recipients = [...(emailData.to ?? []), ...(emailData.cc ?? [])]
    .map((recipient) => normalizeEmailAddress(recipient?.email))
    .filter((email): email is string => Boolean(email));

  return {
    fromAddress,
    fromDomain: fromAddress ? (extractEmailDomain(fromAddress) ?? '') : '',
    toAddresses: recipients,
    subject: emailData.subject ?? '',
    bodyText: (emailData.body?.text ?? '').slice(0, MAX_BODY_TEXT_LENGTH),
  };
}

function operatorMatches(
  candidate: string,
  condition: InboundEmailRuleCondition
): boolean {
  const haystack = candidate.toLowerCase();
  const needle = (condition.value ?? '').toLowerCase();

  switch (condition.operator) {
    case 'equals':
      return haystack === needle;
    case 'contains':
      return needle.length > 0 && haystack.includes(needle);
    case 'starts_with':
      return needle.length > 0 && haystack.startsWith(needle);
    case 'ends_with':
      return needle.length > 0 && haystack.endsWith(needle);
    case 'matches_regex': {
      const pattern = compileRulePattern(condition.value, `condition on ${condition.field}`);
      return pattern ? pattern.test(candidate) : false;
    }
    default:
      return false;
  }
}

export function evaluateCondition(
  condition: InboundEmailRuleCondition,
  input: InboundEmailRuleEmailInput
): boolean {
  switch (condition.field) {
    case 'from_address':
      return operatorMatches(input.fromAddress, condition);
    case 'from_domain':
      return operatorMatches(input.fromDomain, condition);
    case 'to_address':
      return input.toAddresses.some((address) => operatorMatches(address, condition));
    case 'subject':
      return operatorMatches(input.subject, condition);
    case 'body_text':
      return operatorMatches(input.bodyText, condition);
    default:
      return false;
  }
}

/** ALL-of semantics: every condition must pass. An empty list never matches. */
export function evaluateConditions(
  conditions: InboundEmailRuleCondition[],
  input: InboundEmailRuleEmailInput
): { matched: boolean; results: InboundEmailRuleConditionResult[] } {
  if (!Array.isArray(conditions) || conditions.length === 0) {
    return { matched: false, results: [] };
  }

  const results = conditions.map((condition) => ({
    condition,
    passed: evaluateCondition(condition, input),
  }));

  return {
    matched: results.every((result) => result.passed),
    results,
  };
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compile a friendly extraction template to a regex so templates and raw
 * regex share one extraction code path. Group 1 is the extracted value.
 */
export function extractionToRegexSource(extraction: InboundEmailExtraction): string | null {
  switch (extraction.type) {
    case 'between': {
      if (!extraction.start || !extraction.end) return null;
      const start = escapeRegExp(extraction.start);
      const end = escapeRegExp(extraction.end);
      return `${start}([\\s\\S]*?)${end}`;
    }
    case 'after': {
      if (!extraction.marker) return null;
      return `${escapeRegExp(extraction.marker)}\\s*([^\\r\\n]+)`;
    }
    case 'before': {
      if (!extraction.marker) return null;
      return `([^\\r\\n]+?)\\s*${escapeRegExp(extraction.marker)}`;
    }
    case 'regex':
      return extraction.pattern || null;
    default:
      return null;
  }
}

/** Trim, collapse internal whitespace, lowercase. Empty result = no value. */
export function normalizeExtractedValue(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Run an extract_assign_client extraction against the email. Returns the raw
 * (un-normalized) captured value, or null when the pattern doesn't match,
 * captures nothing, or is invalid.
 */
export function extractValue(
  config: ExtractAssignClientActionConfig,
  input: InboundEmailRuleEmailInput
): string | null {
  const source = config.source === 'body_text' ? input.bodyText : input.subject;
  if (!source) {
    return null;
  }

  const regexSource = extractionToRegexSource(config.extraction);
  if (!regexSource) {
    return null;
  }

  const occurrence =
    config.extraction.type !== 'regex' ? (config.extraction.occurrence ?? 'first') : 'first';

  if (occurrence === 'last') {
    const globalPattern = compileRulePatternGlobal(regexSource);
    if (!globalPattern) return null;

    let lastCapture: string | null = null;
    for (const match of source.matchAll(globalPattern)) {
      if (typeof match[1] === 'string') {
        lastCapture = match[1];
      }
    }
    return lastCapture;
  }

  const pattern = compileRulePattern(regexSource, 'extraction');
  if (!pattern) return null;

  const match = source.match(pattern);
  // Capture group 1 is required; a pattern without one extracts nothing.
  return match && typeof match[1] === 'string' ? match[1] : null;
}

function compileRulePatternGlobal(pattern: string): RegExp | null {
  if (!pattern || pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    return null;
  }
  try {
    return new RegExp(pattern, 'gi');
  } catch {
    return null;
  }
}
