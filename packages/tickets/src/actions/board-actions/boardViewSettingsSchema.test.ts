// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { parseTicketViewSettings, ticketViewSettingsSchema } from './boardViewSettingsSchema';

const USER = '11111111-2222-4333-8444-555555555555';
const TEAM = 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee';

describe('board view write schema assignedToIds', () => {
  it('accepts UUID assignee ids', () => {
    const parsed = ticketViewSettingsSchema.safeParse({
      filters: { assignedToIds: [USER, TEAM] },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects non-UUID assignee tokens so a bad view cannot be persisted', () => {
    const parsed = ticketViewSettingsSchema.safeParse({
      filters: { assignedToIds: ['legacy-token', USER] },
    });
    expect(parsed.success).toBe(false);
  });

  it('throws a readable message naming the offending field', () => {
    expect(() => parseTicketViewSettings({ filters: { assignedToIds: ['legacy-token'] } }))
      .toThrow(/assignedToIds/);
  });
});
