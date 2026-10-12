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
      return entry.status !== 'covered' && !/^alga(?:-\d{4}-)?\d+$/.test(entry.ticket);
    });
    expect(missing).toEqual([]);
  });

  it('never cites the card itself (alga0002106) as the ticket for an exclusion', () => {
    const citingCard = eventTypes.filter((eventType) => {
      const entry = emitterContracts[eventType];
      return entry.status !== 'covered' && entry.ticket === 'alga0002106';
    });
    expect(citingCard).toEqual([]);
  });

  describe.each(eventTypes)('%s', (eventType) => {
    const entry = emitterContracts[eventType];

    if (entry.status === 'no-product-emitter') {
      it(`has no product emitter (${entry.ticket}: ${entry.reason})`, () => {
        // Listed, not skipped. Umbrella ticket: ${NO_EMITTER_UMBRELLA_TICKET}
        expect(entry.ticket).toMatch(/^alga(?:-\d{4}-)?\d+$/);
      });
      if (entry.builderProbe) {
        const probe = entry.builderProbe;
        it(`${probe.site} builder passes the worker schema`, () => {
          assertEmitterCase(eventType, probe);
        });
      }
      return;
    }

    if (entry.status === 'covered') {
      for (const drift of entry.knownDriftCases ?? []) {
        it(`knownDriftCases cite a real ticket (${drift.ticket})`, () => {
          expect(drift.ticket).toMatch(/^alga(?:-\d{4}-)?\d+$/);
          expect(drift.ticket).not.toBe('alga0002106');
        });
        it.fails(`[known-drift ${drift.ticket}] ${drift.case.site}: ${drift.reason}`, () => {
          assertEmitterCase(eventType, drift.case);
        });
      }
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
