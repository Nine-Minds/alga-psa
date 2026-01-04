/**
 * Unit Tests for Extension Scheduler Host API
 *
 * Tests for the scheduler capability system and validation functions.
 * These are unit tests that don't require database connections.
 *
 * Test IDs covered:
 * - T001-T004: Capability registration and manifest validation
 * - T046-T057: Input validation tests (calling actual validators)
 * - T097-T098: Sample extension manifest tests
 *
 * Note: T005-T025 and T093-T096 were removed as they were trivial type tests
 * that only verified TypeScript compilation (redundant with tsc).
 */

import { describe, it, expect } from 'vitest';
import {
  KNOWN_PROVIDER_CAPABILITIES,
  DEFAULT_PROVIDER_CAPABILITIES,
  isKnownCapability,
  coerceProviders,
  withDefaultProviders,
} from '@ee/lib/extensions/providers';

import {
  validateCronExpression,
  validateTimezone,
  validatePayloadJson,
  validateScheduleName,
  validateUuid,
  SchedulerInputError,
} from '@ee/lib/extensions/schedulerValidation';

// ============================================================================
// T001-T003: Capability Registration Tests
// ============================================================================

describe('Capability Registration (T001-T003)', () => {
  // T001: cap:scheduler.manage appears in KNOWN_PROVIDER_CAPABILITIES
  it('T001: cap:scheduler.manage appears in KNOWN_PROVIDER_CAPABILITIES', () => {
    expect(KNOWN_PROVIDER_CAPABILITIES).toContain('cap:scheduler.manage');
  });

  // T002: cap:scheduler.manage is NOT in DEFAULT_PROVIDER_CAPABILITIES
  it('T002: cap:scheduler.manage is NOT in DEFAULT_PROVIDER_CAPABILITIES', () => {
    expect(DEFAULT_PROVIDER_CAPABILITIES).not.toContain('cap:scheduler.manage');
  });

  // T003: isKnownCapability('cap:scheduler.manage') returns true
  it('T003: isKnownCapability returns true for cap:scheduler.manage', () => {
    expect(isKnownCapability('cap:scheduler.manage')).toBe(true);
  });

  it('normalizes capability case correctly', () => {
    expect(isKnownCapability('CAP:SCHEDULER.MANAGE')).toBe(true);
    expect(isKnownCapability('Cap:Scheduler.Manage')).toBe(true);
    expect(isKnownCapability('  cap:scheduler.manage  ')).toBe(true);
  });

  it('coerceProviders filters and normalizes capabilities', () => {
    const input = ['cap:scheduler.manage', 'cap:invalid.cap', 'cap:http.fetch'];
    const result = coerceProviders(input);
    expect(result).toContain('cap:scheduler.manage');
    expect(result).toContain('cap:http.fetch');
    expect(result).not.toContain('cap:invalid.cap');
  });

  it('withDefaultProviders includes defaults but not scheduler.manage', () => {
    const result = withDefaultProviders([]);
    expect(result).toContain('cap:context.read');
    expect(result).toContain('cap:log.emit');
    expect(result).toContain('cap:user.read');
    expect(result).not.toContain('cap:scheduler.manage');
  });

  it('withDefaultProviders includes scheduler.manage when explicitly requested', () => {
    const result = withDefaultProviders(['cap:scheduler.manage']);
    expect(result).toContain('cap:scheduler.manage');
    expect(result).toContain('cap:context.read');
  });
});

// ============================================================================
// T004: Extension manifest with cap:scheduler.manage validates successfully
// ============================================================================

describe('Manifest Validation (T004)', () => {
  it('T004: Extension manifest with cap:scheduler.manage is valid', async () => {
    // Import the manifest schema
    const { validateManifestV2 } = await import('@ee/lib/extensions/schemas/manifest-v2.schema');

    const manifest = {
      name: 'com.test.scheduler-demo',
      publisher: 'Test',
      version: '1.0.0',
      runtime: 'wasm-js@1',
      capabilities: ['cap:scheduler.manage', 'cap:log.emit'],
      ui: {
        type: 'iframe' as const,
        entry: 'ui/index.html',
      },
      api: {
        endpoints: [
          { method: 'GET', path: '/api/status', handler: 'dist/main' },
        ],
      },
    };

    const result = validateManifestV2(manifest);
    expect(result.valid).toBe(true);
    expect(result.data?.capabilities).toContain('cap:scheduler.manage');
  });
});

// ============================================================================
// T046-T057: Validation Tests - Calling ACTUAL validation functions
// ============================================================================

describe('Cron Expression Validation (T046-T050)', () => {
  describe('T046: rejects invalid cron expression (wrong field count)', () => {
    it('rejects 4-field cron', () => {
      expect(() => validateCronExpression('* * * *')).toThrow(SchedulerInputError);
      expect(() => validateCronExpression('* * * *')).toThrow('expected 5 fields');
    });

    it('rejects 6-field cron', () => {
      expect(() => validateCronExpression('* * * * * *')).toThrow(SchedulerInputError);
      expect(() => validateCronExpression('* * * * * *')).toThrow('expected 5 fields');
    });

    it('rejects empty cron', () => {
      expect(() => validateCronExpression('')).toThrow(SchedulerInputError);
    });

    it('rejects cron with only spaces', () => {
      expect(() => validateCronExpression('   ')).toThrow(SchedulerInputError);
    });
  });

  describe('T047: rejects invalid cron expression (bad characters)', () => {
    it('rejects letters in minute field', () => {
      expect(() => validateCronExpression('a * * * *')).toThrow(SchedulerInputError);
      expect(() => validateCronExpression('a * * * *')).toThrow('unsupported characters');
    });

    it('rejects letters in hour field', () => {
      expect(() => validateCronExpression('* b * * *')).toThrow(SchedulerInputError);
    });

    it('rejects special characters', () => {
      expect(() => validateCronExpression('* * @ * *')).toThrow(SchedulerInputError);
      expect(() => validateCronExpression('* * # * *')).toThrow(SchedulerInputError);
      expect(() => validateCronExpression('* * % * *')).toThrow(SchedulerInputError);
    });
  });

  describe('T048: validates cron cannot have both day-of-month and day-of-week set', () => {
    it('rejects 15th day AND Monday', () => {
      expect(() => validateCronExpression('0 0 15 * 1')).toThrow(SchedulerInputError);
      expect(() => validateCronExpression('0 0 15 * 1')).toThrow('both day-of-month and day-of-week');
    });

    it('rejects any specific day-of-month with specific day-of-week', () => {
      expect(() => validateCronExpression('0 0 1 * 0')).toThrow(SchedulerInputError);
      expect(() => validateCronExpression('0 0 28 * 5')).toThrow(SchedulerInputError);
    });

    it('accepts specific day-of-month with wildcard day-of-week', () => {
      expect(() => validateCronExpression('0 0 15 * *')).not.toThrow();
    });

    it('accepts wildcard day-of-month with specific day-of-week', () => {
      expect(() => validateCronExpression('0 0 * * 1')).not.toThrow();
    });
  });

  describe('T049: validates minimum interval (rejects every-minute cron)', () => {
    it('rejects every minute (* * * * *)', () => {
      expect(() => validateCronExpression('* * * * *')).toThrow(SchedulerInputError);
      expect(() => validateCronExpression('* * * * *')).toThrow('minimum interval is 5 minutes');
    });

    it('rejects every 1 minute (*/1 * * * *)', () => {
      expect(() => validateCronExpression('*/1 * * * *')).toThrow(SchedulerInputError);
    });

    it('rejects every 2 minutes (*/2 * * * *)', () => {
      expect(() => validateCronExpression('*/2 * * * *')).toThrow(SchedulerInputError);
    });

    it('rejects every 3 minutes (*/3 * * * *)', () => {
      expect(() => validateCronExpression('*/3 * * * *')).toThrow(SchedulerInputError);
    });

    it('rejects every 4 minutes (*/4 * * * *)', () => {
      expect(() => validateCronExpression('*/4 * * * *')).toThrow(SchedulerInputError);
    });
  });

  describe('T050: accepts valid cron expressions', () => {
    it('accepts every 5 minutes (*/5 * * * *)', () => {
      const result = validateCronExpression('*/5 * * * *');
      expect(result).toBe('*/5 * * * *');
    });

    it('accepts every 10 minutes (*/10 * * * *)', () => {
      const result = validateCronExpression('*/10 * * * *');
      expect(result).toBe('*/10 * * * *');
    });

    it('accepts hourly (0 * * * *)', () => {
      const result = validateCronExpression('0 * * * *');
      expect(result).toBe('0 * * * *');
    });

    it('accepts daily at 9am (0 9 * * *)', () => {
      const result = validateCronExpression('0 9 * * *');
      expect(result).toBe('0 9 * * *');
    });

    it('accepts every Monday at midnight (0 0 * * 1)', () => {
      const result = validateCronExpression('0 0 * * 1');
      expect(result).toBe('0 0 * * 1');
    });

    it('accepts 1st of every month (0 0 1 * *)', () => {
      const result = validateCronExpression('0 0 1 * *');
      expect(result).toBe('0 0 1 * *');
    });

    it('trims whitespace', () => {
      const result = validateCronExpression('  */5 * * * *  ');
      expect(result).toBe('*/5 * * * *');
    });
  });
});

describe('Timezone Validation (T051-T052)', () => {
  describe('T051: rejects invalid timezone', () => {
    it('rejects Invalid/Timezone', () => {
      expect(() => validateTimezone('Invalid/Timezone')).toThrow(SchedulerInputError);
      expect(() => validateTimezone('Invalid/Timezone')).toThrow('Invalid timezone');
    });

    it('rejects NotATimezone', () => {
      expect(() => validateTimezone('NotATimezone')).toThrow(SchedulerInputError);
    });

    it('rejects random string', () => {
      expect(() => validateTimezone('ABC')).toThrow(SchedulerInputError);
    });

    it('rejects timezone that is too long', () => {
      const longTz = 'A'.repeat(65);
      expect(() => validateTimezone(longTz)).toThrow(SchedulerInputError);
      expect(() => validateTimezone(longTz)).toThrow('too long');
    });
  });

  describe('T052: accepts valid IANA timezone', () => {
    it('accepts UTC', () => {
      const result = validateTimezone('UTC');
      expect(result).toBe('UTC');
    });

    it('accepts America/New_York', () => {
      const result = validateTimezone('America/New_York');
      expect(result).toBe('America/New_York');
    });

    it('accepts Europe/London', () => {
      const result = validateTimezone('Europe/London');
      expect(result).toBe('Europe/London');
    });

    it('accepts Asia/Tokyo', () => {
      const result = validateTimezone('Asia/Tokyo');
      expect(result).toBe('Asia/Tokyo');
    });

    it('accepts Pacific/Auckland', () => {
      const result = validateTimezone('Pacific/Auckland');
      expect(result).toBe('Pacific/Auckland');
    });

    it('defaults to UTC when empty', () => {
      const result = validateTimezone('');
      expect(result).toBe('UTC');
    });

    it('defaults to UTC when undefined', () => {
      const result = validateTimezone(undefined);
      expect(result).toBe('UTC');
    });

    it('trims whitespace', () => {
      const result = validateTimezone('  America/New_York  ');
      expect(result).toBe('America/New_York');
    });
  });
});

describe('Payload Validation (T055-T056)', () => {
  describe('T055: validates payload size limit (100KB)', () => {
    it('rejects payload over 100KB', () => {
      const largePayload = { data: 'x'.repeat(100_001) };
      expect(() => validatePayloadJson(largePayload)).toThrow(SchedulerInputError);
      expect(() => validatePayloadJson(largePayload)).toThrow('too large');
    });

    it('accepts payload at exactly 100KB boundary', () => {
      // Create a payload that's just under 100KB
      const almostTooLarge = { data: 'x'.repeat(99_980) };
      expect(() => validatePayloadJson(almostTooLarge)).not.toThrow();
    });
  });

  describe('T056: validates payload must be JSON-serializable', () => {
    it('accepts object payload', () => {
      const result = validatePayloadJson({ key: 'value' });
      expect(result).toEqual({ key: 'value' });
    });

    it('accepts array payload', () => {
      const result = validatePayloadJson(['item1', 'item2']);
      expect(result).toEqual(['item1', 'item2']);
    });

    it('accepts nested object payload', () => {
      const payload = { nested: { deep: { value: true } } };
      const result = validatePayloadJson(payload);
      expect(result).toEqual(payload);
    });

    it('accepts null payload', () => {
      const result = validatePayloadJson(null);
      expect(result).toBeNull();
    });

    it('accepts undefined payload', () => {
      const result = validatePayloadJson(undefined);
      expect(result).toBeNull();
    });

    it('rejects string payload (must be object or array)', () => {
      expect(() => validatePayloadJson('just a string')).toThrow(SchedulerInputError);
      expect(() => validatePayloadJson('just a string')).toThrow('must be a JSON object or array');
    });

    it('rejects number payload', () => {
      expect(() => validatePayloadJson(42)).toThrow(SchedulerInputError);
    });

    it('rejects boolean payload', () => {
      expect(() => validatePayloadJson(true)).toThrow(SchedulerInputError);
    });
  });
});

describe('Name Validation (T057)', () => {
  describe('T057: rejects name longer than 128 characters', () => {
    it('rejects 129-character name', () => {
      const longName = 'x'.repeat(129);
      expect(() => validateScheduleName(longName)).toThrow(SchedulerInputError);
      expect(() => validateScheduleName(longName)).toThrow('too long');
    });

    it('rejects 200-character name', () => {
      const longName = 'x'.repeat(200);
      expect(() => validateScheduleName(longName)).toThrow(SchedulerInputError);
    });
  });

  it('accepts 128-character name (at limit)', () => {
    const maxName = 'x'.repeat(128);
    const result = validateScheduleName(maxName);
    expect(result).toBe(maxName);
  });

  it('accepts normal name', () => {
    const result = validateScheduleName('My Schedule Name');
    expect(result).toBe('My Schedule Name');
  });

  it('returns null for null input', () => {
    const result = validateScheduleName(null);
    expect(result).toBeNull();
  });

  it('returns null for undefined input', () => {
    const result = validateScheduleName(undefined);
    expect(result).toBeNull();
  });

  it('returns null for empty string', () => {
    const result = validateScheduleName('');
    expect(result).toBeNull();
  });

  it('trims whitespace', () => {
    const result = validateScheduleName('  My Schedule  ');
    expect(result).toBe('My Schedule');
  });
});

describe('UUID Validation', () => {
  it('accepts valid UUID v4', () => {
    const uuid = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const result = validateUuid(uuid, 'scheduleId');
    expect(result).toBe(uuid);
  });

  it('accepts valid UUID v1', () => {
    const uuid = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    const result = validateUuid(uuid, 'scheduleId');
    expect(result).toBe(uuid);
  });

  it('rejects invalid UUID format', () => {
    expect(() => validateUuid('not-a-uuid', 'scheduleId')).toThrow(SchedulerInputError);
    expect(() => validateUuid('not-a-uuid', 'scheduleId')).toThrow('Invalid scheduleId');
  });

  it('rejects empty string', () => {
    expect(() => validateUuid('', 'scheduleId')).toThrow('Missing scheduleId');
  });

  it('rejects UUID with wrong length', () => {
    expect(() => validateUuid('a0eebc99-9c0b-4ef8-bb6d', 'scheduleId')).toThrow(SchedulerInputError);
  });

  it('trims whitespace', () => {
    const uuid = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const result = validateUuid(`  ${uuid}  `, 'scheduleId');
    expect(result).toBe(uuid);
  });

  it('uses field name in error message', () => {
    expect(() => validateUuid('invalid', 'myField')).toThrow('Invalid myField');
  });
});

describe('SchedulerInputError', () => {
  it('has field property', () => {
    const error = new SchedulerInputError('cron', 'Invalid cron');
    expect(error.field).toBe('cron');
    expect(error.message).toBe('Invalid cron');
    expect(error.name).toBe('SchedulerInputError');
  });

  it('is instanceof Error', () => {
    const error = new SchedulerInputError('timezone', 'Bad timezone');
    expect(error).toBeInstanceOf(Error);
  });
});

// ============================================================================
// T097-T098: Sample Extension Tests
// ============================================================================

describe('Sample Extension (T097-T098)', () => {
  it('T097: Sample extension has manifest declaring cap:scheduler.manage', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');

    const manifestPath = path.join(
      process.cwd(),
      '..',
      '..',
      'sdk/samples/component/scheduler-demo/manifest.json'
    );

    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);
      expect(manifest.capabilities).toContain('cap:scheduler.manage');
    } catch (e) {
      // If running from different directory, try alternative path
      const altPath = path.resolve(
        __dirname,
        '../../../../../sdk/samples/component/scheduler-demo/manifest.json'
      );
      const content = await fs.readFile(altPath, 'utf-8');
      const manifest = JSON.parse(content);
      expect(manifest.capabilities).toContain('cap:scheduler.manage');
    }
  });

  it('T098: Sample extension has /setup endpoint', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');

    const manifestPath = path.join(
      process.cwd(),
      '..',
      '..',
      'sdk/samples/component/scheduler-demo/manifest.json'
    );

    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);
      const hasSetup = manifest.api?.endpoints?.some(
        (e: { path: string }) => e.path === '/api/setup'
      );
      expect(hasSetup).toBe(true);
    } catch (e) {
      // If running from different directory, try alternative path
      const altPath = path.resolve(
        __dirname,
        '../../../../../sdk/samples/component/scheduler-demo/manifest.json'
      );
      const content = await fs.readFile(altPath, 'utf-8');
      const manifest = JSON.parse(content);
      const hasSetup = manifest.api?.endpoints?.some(
        (e: { path: string }) => e.path === '/api/setup'
      );
      expect(hasSetup).toBe(true);
    }
  });
});
