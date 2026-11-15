import { z } from 'zod';
import type { ControlRegistry } from '@alga-psa/emulator-host';
import type { GoogleCalendarCore } from './core';

export function register(reg: ControlRegistry, core: GoogleCalendarCore): void {
  reg.seeder({
    name: 'oauth-client',
    description: 'Register the refresh/access token pair a provider is configured with',
    params: z.object({ refreshToken: z.string().optional(), accessToken: z.string().optional() }),
    run: (input) => core.seedClient(input),
  });

  reg.seeder({
    name: 'event',
    description: 'Insert a calendar event; supply recurrence[] to create a series master',
    params: z.object({
      calendarId: z.string().default('primary'),
      event: z.record(z.string(), z.unknown()).default({}),
    }),
    run: ({ calendarId, event }) => core.insertEvent(calendarId, event as Record<string, any>),
  });

  reg.seeder({
    name: 'cancel-occurrence',
    description: 'Cancel one occurrence of a series, as deleting a single instance does',
    params: z.object({ seriesMasterId: z.string(), originalStart: z.string() }),
    run: ({ seriesMasterId, originalStart }) => {
      core.cancelOccurrence(seriesMasterId, new Date(originalStart).toISOString());
      return { seriesMasterId, originalStart };
    },
  });

  reg.seeder({
    name: 'expansion-cap',
    description: 'Instance count an unbounded series expands to (Google answered 730 in production)',
    params: z.object({ cap: z.number().int().positive().max(5000) }),
    run: ({ cap }) => {
      core.expansionCap = cap;
      return { cap };
    },
  });

  reg.action({
    name: 'expire-sync-tokens',
    description: 'Invalidate every issued sync token so the next list answers 410 fullSyncRequired',
    run: () => ({ expired: core.expireSyncTokens() }),
  });

  reg.stateView({
    name: 'events',
    description: 'Stored events (series masters, standalone events and instance overrides)',
    get: () => [...core.events.values()],
  });

  reg.stateView({
    name: 'channels',
    description: 'Active push channels created through events.watch',
    get: () => [...core.channels.values()],
  });
}
