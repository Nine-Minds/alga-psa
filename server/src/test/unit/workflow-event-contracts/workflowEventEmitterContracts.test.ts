import { describe, expect, it } from 'vitest';
import { WORKFLOW_EVENT_CATALOG, type WorkflowCatalogEventType } from '@alga-psa/event-schemas';
import { emitterContracts } from './emitterContracts';
import { assertEmitterCase } from './harness';
import { NO_EMITTER_UMBRELLA_TICKET } from './registryTypes';

const eventTypes = Object.keys(WORKFLOW_EVENT_CATALOG) as WorkflowCatalogEventType[];

describe('workflow event emitter contracts', () => {
  it('has a registry entry for every catalogued event and no extras', () => {
    expect(Object.keys(emitterContracts).sort()).toEqual([...eventTypes].sort());
  });

  it('cites a ticket for every entry that is not covered', () => {
    const missing = eventTypes.filter((eventType) => {
      const entry = emitterContracts[eventType];
      return entry.status !== 'covered' && !/^alga\d+$/.test(entry.ticket);
    });
    expect(missing).toEqual([]);
  });

  describe.each(eventTypes)('%s', (eventType) => {
    const entry = emitterContracts[eventType];

    if (entry.status === 'no-product-emitter') {
      it(`has no product emitter (${entry.ticket}: ${entry.reason})`, () => {
        // Listed, not skipped. Umbrella ticket: ${NO_EMITTER_UMBRELLA_TICKET}
        expect(entry.ticket).toMatch(/^alga\d+$/);
      });
      return;
    }

    for (const emitterCase of entry.cases) {
      if (entry.status === 'covered') {
        it(`${emitterCase.site} passes the worker schema`, () => {
          assertEmitterCase(eventType, emitterCase);
        });
      } else {
        // Fixing the drift turns this red, which forces the exclusion to be removed.
        it.fails(`[known-drift ${entry.ticket}] ${emitterCase.site}: ${entry.reason}`, () => {
          assertEmitterCase(eventType, emitterCase);
        });
      }
    }
  });
});
