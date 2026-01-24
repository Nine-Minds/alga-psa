/**
 * Unit Tests for Extension Invoicing Host API (Manual Invoice MVP)
 *
 * These tests validate capability registration and manifest parsing behavior.
 *
 * Test IDs covered:
 * - T001-T004: Capability registration and manifest validation
 */

import { describe, it, expect } from 'vitest';
import {
  KNOWN_PROVIDER_CAPABILITIES,
  DEFAULT_PROVIDER_CAPABILITIES,
  isKnownCapability,
  CAP_INVOICE_MANUAL_CREATE,
} from '@ee/lib/extensions/providers';

// ============================================================================
// T001-T003: Capability Registration Tests
// ============================================================================

describe('Invoicing Capability Registration (T001-T003)', () => {
  it('T001: cap:invoice.manual.create appears in KNOWN_PROVIDER_CAPABILITIES', () => {
    expect(KNOWN_PROVIDER_CAPABILITIES).toContain(CAP_INVOICE_MANUAL_CREATE);
  });

  it('T002: cap:invoice.manual.create is NOT in DEFAULT_PROVIDER_CAPABILITIES', () => {
    expect(DEFAULT_PROVIDER_CAPABILITIES).not.toContain(CAP_INVOICE_MANUAL_CREATE);
  });

  it('T003: isKnownCapability returns true and normalizes case/whitespace', () => {
    expect(isKnownCapability(CAP_INVOICE_MANUAL_CREATE)).toBe(true);
    expect(isKnownCapability('CAP:INVOICE.MANUAL.CREATE')).toBe(true);
    expect(isKnownCapability('Cap:Invoice.Manual.Create')).toBe(true);
    expect(isKnownCapability('  cap:invoice.manual.create  ')).toBe(true);
  });
});

// ============================================================================
// T004: Extension manifest with cap:invoice.manual.create validates successfully
// ============================================================================

describe('Manifest Validation (T004)', () => {
  it('T004: Extension manifest with cap:invoice.manual.create is valid', async () => {
    const { validateManifestV2 } = await import('@ee/lib/extensions/schemas/manifest-v2.schema');

    const manifest = {
      name: 'com.test.invoice-demo',
      publisher: 'Test',
      version: '1.0.0',
      runtime: 'wasm-js@1',
      capabilities: [CAP_INVOICE_MANUAL_CREATE, 'cap:log.emit'],
      ui: {
        type: 'iframe' as const,
        entry: 'ui/index.html',
      },
      api: {
        endpoints: [{ method: 'POST', path: '/api/create', handler: 'dist/main' }],
      },
    };

    const result = validateManifestV2(manifest);
    expect(result.valid).toBe(true);
    expect(result.data?.capabilities).toContain(CAP_INVOICE_MANUAL_CREATE);
  });
});

