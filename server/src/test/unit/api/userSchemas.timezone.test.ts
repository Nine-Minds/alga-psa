import { describe, expect, it } from 'vitest';
import { timezoneSchema } from '../../../lib/api/schemas/userSchemas';

describe('userSchemas.timezoneSchema', () => {
  it.each(['America/Port-au-Prince', 'UTC', 'America/New_York', 'America/Argentina/Buenos_Aires'])(
    'accepts %s',
    (zone) => {
      expect(timezoneSchema.parse(zone)).toBe(zone);
    },
  );

  it('maps UTC aliases to UTC', () => {
    expect(timezoneSchema.parse('Etc/UTC')).toBe('UTC');
    expect(timezoneSchema.parse('GMT')).toBe('UTC');
  });

  it.each(['EST', 'Etc/GMT+5', 'US/Eastern', 'Not/AZone', ''])('rejects %j', (zone) => {
    expect(timezoneSchema.safeParse(zone).success).toBe(false);
  });

  it('stays optional', () => {
    expect(timezoneSchema.parse(undefined)).toBeUndefined();
  });
});
