import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { ISO8601String } from 'server/src/types/types.d';
import { TestContext } from '../../../test-utils/testContext';
import { toPlainDate } from 'server/src/lib/utils/dateTimeUtils';
import {
  createPricingSchedule,
  getActivePricingSchedule,
  getActiveScheduleForPeriod,
  getPricingSchedules,
  createScheduleSequence
} from '../test-utils/pricingScheduleHelpers';

describe('Pricing Schedule Integration Tests', () => {
  const {
    beforeAll: setupContext,
    beforeEach: resetContext,
    afterEach: rollbackContext,
    afterAll: cleanupContext
  } = TestContext.createHelpers();

  let context: TestContext;
  let contractId: string;

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'contract_pricing_schedules',
        'client_contracts',
        'contracts'
      ],
      clientName: 'Pricing Schedule Test Client'
    });
  }, 120000);

  afterAll(async () => {
    await cleanupContext();
  });

  beforeEach(async () => {
    context = await resetContext();
    contractId = await context.createEntity('contracts', {
      contract_name: 'Test Contract for Pricing Schedules',
      billing_frequency: 'monthly',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, 'contract_id');
  });

  afterEach(async () => {
    await rollbackContext();
  });

  describe('Create and Persist Pricing Schedules', () => {
    it('should create a pricing schedule and persist to database', async () => {
      const effectiveDate = '2023-01-01T00:00:00.000Z' as ISO8601String;
      const customRate = 15000;

      const scheduleId = await createPricingSchedule(context, contractId, {
        effectiveDate,
        customRate,
        notes: 'Initial rate'
      });

      const saved = await context.db('contract_pricing_schedules')
        .where('schedule_id', scheduleId)
        .first();

      expect(saved).toBeDefined();
      expect(saved.schedule_id).toBe(scheduleId);
      expect(saved.contract_id).toBe(contractId);
      expect(saved.custom_rate).toBe(customRate);
      const expectedPlainDate = toPlainDate(effectiveDate).toString();
      expect(toPlainDate(saved.effective_date).toString()).toBe(expectedPlainDate);
    });

    it('should retrieve active pricing schedule for a billing period', async () => {
      const scheduleId = await createPricingSchedule(context, contractId, {
        effectiveDate: '2023-01-15T00:00:00.000Z' as ISO8601String,
        endDate: '2023-01-31T00:00:00.000Z' as ISO8601String,
        customRate: 12000
      });

      const activeSchedule = await getActiveScheduleForPeriod(
        context,
        contractId,
        '2023-01-01T00:00:00.000Z' as ISO8601String,
        '2023-02-01T00:00:00.000Z' as ISO8601String
      );

      expect(activeSchedule).toBeDefined();
      expect(activeSchedule.schedule_id).toBe(scheduleId);
      expect(activeSchedule.custom_rate).toBe(12000);
    });

    it('should handle multiple schedules and return the most recent effective schedule', async () => {
      const [, latestScheduleId] = await createScheduleSequence(context, contractId, [
        {
          effectiveDate: '2023-01-01T00:00:00.000Z' as ISO8601String,
          endDate: '2023-01-14T00:00:00.000Z' as ISO8601String,
          customRate: 10000
        },
        {
          effectiveDate: '2023-01-15T00:00:00.000Z' as ISO8601String,
          endDate: null,
          customRate: 15000
        }
      ]);

      const mostRecentSchedule = await getActiveScheduleForPeriod(
        context,
        contractId,
        '2023-01-01T00:00:00.000Z' as ISO8601String,
        '2023-02-01T00:00:00.000Z' as ISO8601String
      );

      expect(mostRecentSchedule).toBeDefined();
      expect(mostRecentSchedule.schedule_id).toBe(latestScheduleId);
      expect(mostRecentSchedule.custom_rate).toBe(15000);
    });
  });

  describe('Pricing Schedule Boundaries', () => {
    it('should correctly filter schedules across billing period boundaries', async () => {
      await createPricingSchedule(context, contractId, {
        effectiveDate: '2023-02-01T00:00:00.000Z' as ISO8601String,
        endDate: '2023-02-28T00:00:00.000Z' as ISO8601String,
        customRate: 11000
      });

      const scenarios = [
        {
          start: '2023-01-01T00:00:00.000Z',
          end: '2023-01-31T00:00:00.000Z',
          expectSchedule: false,
          note: 'Before schedule effective date'
        },
        {
          start: '2023-02-01T00:00:00.000Z',
          end: '2023-02-28T00:00:00.000Z',
          expectSchedule: true,
          note: 'Within schedule date range'
        },
        {
          start: '2023-02-15T00:00:00.000Z',
          end: '2023-03-15T00:00:00.000Z',
          expectSchedule: true,
          note: 'Overlaps with schedule end date'
        },
        {
          start: '2023-03-01T00:00:00.000Z',
          end: '2023-03-31T00:00:00.000Z',
          expectSchedule: false,
          note: 'After schedule end date'
        }
      ];

      for (const scenario of scenarios) {
        const result = await getActiveScheduleForPeriod(
          context,
          contractId,
          scenario.start as ISO8601String,
          scenario.end as ISO8601String
        );

        if (scenario.expectSchedule) {
          expect(result).toBeDefined(`${scenario.note}: should find schedule`);
        } else {
          expect(result).toBeNull(`${scenario.note}: should not find schedule`);
        }
      }
    });

    it('should treat schedules with null end_date as ongoing', async () => {
      const scheduleId = await createPricingSchedule(context, contractId, {
        effectiveDate: '2023-06-01T00:00:00.000Z' as ISO8601String,
        endDate: null,
        customRate: 18000
      });

      const result = await getActiveScheduleForPeriod(
        context,
        contractId,
        '2024-01-01T00:00:00.000Z' as ISO8601String,
        '2024-12-31T00:00:00.000Z' as ISO8601String
      );

      expect(result).toBeDefined();
      expect(result!.schedule_id).toBe(scheduleId);
      expect(result!.end_date).toBeNull();
    });
  });

  describe('Pricing Schedule Updates and Deletes', () => {
    it('should update an existing pricing schedule', async () => {
      const scheduleId = await createPricingSchedule(context, contractId, {
        effectiveDate: '2023-01-01T00:00:00.000Z' as ISO8601String,
        customRate: 10000,
        notes: 'Original rate'
      });

      await context.db('contract_pricing_schedules')
        .where('schedule_id', scheduleId)
        .update({
          custom_rate: 15000,
          notes: 'Updated rate',
          updated_at: new Date().toISOString()
        });

      const updated = await context.db('contract_pricing_schedules')
        .where('schedule_id', scheduleId)
        .first();

      expect(updated.custom_rate).toBe(15000);
      expect(updated.notes).toBe('Updated rate');
    });

    it('should delete a pricing schedule', async () => {
      const scheduleId = await createPricingSchedule(context, contractId, {
        effectiveDate: '2023-01-01T00:00:00.000Z' as ISO8601String,
        customRate: 10000
      });

      await context.db('contract_pricing_schedules')
        .where('schedule_id', scheduleId)
        .delete();

      const afterDelete = await getPricingSchedules(context, contractId);
      expect(afterDelete).toHaveLength(0);
    });

    it('should mark a schedule as expired when setting end_date', async () => {
      const scheduleId = await createPricingSchedule(context, contractId, {
        effectiveDate: '2023-01-01T00:00:00.000Z' as ISO8601String,
        customRate: 10000
      });

      const expiryDate = '2023-12-31T00:00:00.000Z';

      await context.db('contract_pricing_schedules')
        .where('schedule_id', scheduleId)
        .update({
          end_date: expiryDate,
          updated_at: new Date().toISOString()
        });

      const expired = await getActivePricingSchedule(
        context,
        contractId,
        '2024-01-01T00:00:00.000Z' as ISO8601String
      );

      expect(expired).toBeNull();
    });
  });

  describe('Pricing Schedule for No Rates', () => {
    it('should allow schedules without custom_rate and treat them as null overrides', async () => {
      const scheduleId = await createPricingSchedule(context, contractId, {
        effectiveDate: '2023-01-01T00:00:00.000Z' as ISO8601String,
        customRate: null,
        notes: 'Placeholder schedule'
      });

      const schedule = await context.db('contract_pricing_schedules')
        .where('schedule_id', scheduleId)
        .first();

      expect(schedule).toBeDefined();
      expect(schedule.custom_rate).toBeNull();
    });

    it('should return no schedule when contract has none defined', async () => {
      const schedules = await getPricingSchedules(context, contractId);
      expect(schedules).toHaveLength(0);

      const activeSchedule = await getActivePricingSchedule(
        context,
        contractId,
        '2023-01-01T00:00:00.000Z' as ISO8601String
      );

      expect(activeSchedule).toBeNull();
    });
  });
});
