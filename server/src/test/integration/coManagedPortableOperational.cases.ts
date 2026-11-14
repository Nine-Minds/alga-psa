/** CM L7b3 operational time and schedule export. Billing rows never ride along. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createPortableOperationalContributor, portableOperationalContributor } from '@alga-psa/co-managed/portableOperationalExport';
import { CO_MANAGED_PORTABLE_OPERATIONAL_COLUMNS } from '@alga-psa/co-managed/portableOperationalCatalog';
import { exclusionNames, exportContributor, retainContributor, type PortableWorld } from './helpers/coManagedPortableExportFixture';

export function defineOperationalCases(get: () => { db: Knex; world: PortableWorld }) {
  describe('portable operational export (no billing rows)', () => {
    let operationalId: string, commercialId: string, scheduleId: string;
    beforeAll(async () => {
      const { db, world } = get();
      operationalId = uuidv4(); commercialId = uuidv4(); scheduleId = uuidv4();
      const at = (hour: number) => new Date(Date.UTC(2026, 0, 5, hour));
      for (const [id, notes] of [[operationalId, 'operational effort'], [commercialId, 'billable effort']] as const) {
        await db('time_entries').insert({ tenant: world.customer, entry_id: id, user_id: world.customerStaff.userId, start_time: at(9), end_time: at(10),
          work_date: '2026-01-05', work_timezone: 'UTC', notes, work_item_type: 'ad_hoc', billable_duration: 0 });
      }
      await db('schedule_entries').insert({ tenant: world.customer, entry_id: scheduleId, title: 'Standup', status: 'scheduled', work_item_type: 'ad_hoc',
        scheduled_start: at(9), scheduled_end: at(10) });
    });
    afterAll(async () => { /* tenants are removed by the runner */ });

    it('exports only entries the seam classifies exactly operational, with no billing column', async () => {
      const { db, world } = get();
      const contributor = createPortableOperationalContributor(async (_tenant, _user, entry) => entry.entry_id === operationalId ? 'operational' : 'commercial');
      const { records, annotations } = await exportContributor(db, world, contributor);
      expect(records.time_entries.map(row => row.entry_id)).toEqual([operationalId]);
      expect(Object.keys(records.time_entries[0])).toEqual([...CO_MANAGED_PORTABLE_OPERATIONAL_COLUMNS.time_entries]);
      expect(JSON.stringify(records)).not.toContain('billable effort');
      expect(records.schedule_entries.map(row => row.entry_id)).toContain(scheduleId);
      expect(exclusionNames(annotations)).toContain('time_entries_billing');
    });
    it('fails closed: an unclassified or unexpected answer exports no time', async () => {
      const { db, world } = get();
      for (const answer of [undefined, 'commercial', 'Operational', '']) {
        const { records } = await exportContributor(db, world, createPortableOperationalContributor(async () => answer));
        expect(records.time_entries).toEqual([]);
      }
    });
    it('a native tenant (default seam classifier) yields no time rows and an explicit empty-domain reason', async () => {
      const { db, world } = get();
      const { records, annotations } = await exportContributor(db, world, portableOperationalContributor);
      expect(records.time_entries).toEqual([]);
      expect(records.time_sheets).toEqual([]);
      expect(exclusionNames(annotations)).toContain('time_domain_empty');
    });
    it('retain is deterministic and equals the export', async () => {
      const { db, world } = get();
      const contributor = createPortableOperationalContributor(async (_t, _u, entry) => entry.entry_id === operationalId ? 'operational' : 'commercial');
      const exported = await exportContributor(db, world, contributor);
      expect(JSON.stringify((await retainContributor(db, world, contributor)).records)).toBe(JSON.stringify(exported.records));
    });
  });
}
