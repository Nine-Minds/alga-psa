/**
 * Domain name validation utilities for managed email domains.
 *
 * This module contains pure validation logic without external dependencies
 * to facilitate testing and reusability.
 */

/**
 * Validates a domain name according to RFC standards and best practices.
 *
 * Requirements:
 * - Must have at least 2 labels (e.g., example.com, not just localhost)
 * - TLD must contain at least one letter (no numeric-only TLDs)
 * - No consecutive hyphens
 * - Each label: 1-63 characters
 * - Total domain: max 253 characters
 * - Labels must start/end with alphanumeric, can contain hyphens in middle
 * - No IP addresses
 */
export function isValidDomain(domain: string): boolean {
  // Check total length (max 253 chars per RFC 1035)
  if (domain.length > 253) {
    return false;
  }

  // Check for empty
  if (domain.length === 0) {
    return false;
  }

  // Reject IP addresses (simple check for 4 numeric segments)
  if (/^\d+\.\d+\.\d+\.\d+$/.test(domain)) {
    return false;
  }

  // Reject consecutive hyphens (not allowed in domain labels)
  if (domain.includes('--')) {
    return false;
  }

  // Split into labels
  const labels = domain.split('.');

  // Must have at least 2 labels (domain + TLD)
  if (labels.length < 2) {
    return false;
  }

  // TLD (last label) must contain at least one letter (no numeric-only TLDs)
  const tld = labels[labels.length - 1];
  if (!/[a-z]/i.test(tld)) {
    return false;
  }

  // Check each label
  for (const label of labels) {
    // Each label must be 1-63 chars
    if (label.length === 0 || label.length > 63) {
      return false;
    }

    // Must not start or end with hyphen
    if (label.startsWith('-') || label.endsWith('-')) {
      return false;
    }

    // Must contain only alphanumeric and hyphens (no underscores or special chars)
    if (!/^[a-z0-9-]+$/i.test(label)) {
      return false;
    }
  }

  return true;
}
