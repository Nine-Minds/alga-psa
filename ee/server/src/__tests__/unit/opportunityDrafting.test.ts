import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({ tenantDb: vi.fn() }));

vi.mock('@alga-psa/db', () => ({ tenantDb: dbMocks.tenantDb }));
vi.mock('@alga-psa/tenancy/actions', () => ({
  getExperimentalFeaturesForTenant: vi.fn(),
}));
vi.mock('server/src/lib/tier-gating/assertAddOnAccess', () => ({
  assertTenantAddOnAccess: vi.fn(),
}));

import {
  deleteOpportunityVoiceProfileData,
  generateFollowUpDraftData,
  getOpportunityVoiceProfileData,
  logDraftSentData,
  saveOpportunityVoiceProfileData,
} from '../../lib/opportunities/drafting';
import { assertOpportunityDraftingAccess } from '../../lib/opportunities/draftingAccess';

type Row = Record<string, any>;

class FakeQuery implements PromiseLike<Row[]> {
  private conditions: Row = {};
  private inserted: Row | null = null;
  private limitCount: number | null = null;

  constructor(
    private readonly rows: () => Row[],
    private readonly onMerge?: (conditions: Row, inserted: Row, patch: Row) => void,
    private readonly onDelete?: (conditions: Row) => void,
  ) {}

  where(condition: Row) { Object.assign(this.conditions, condition); return this; }
  whereNull(_column: string) { return this; }
  whereNotNull(_column: string) { return this; }
  select(..._columns: unknown[]) { return this; }
  orderBy(_column: string, _direction?: string) { return this; }
  limit(count: number) { this.limitCount = count; return this; }
  insert(row: Row) { this.inserted = row; return this; }
  onConflict(_columns: string[]) { return this; }

  async merge(patch: Row) {
    if (!this.inserted || !this.onMerge) throw new Error('Unexpected merge');
    this.onMerge(this.conditions, this.inserted, patch);
  }

  async first() {
    return this.filteredRows()[0];
  }

  async delete() {
    this.onDelete?.(this.conditions);
  }

  then<TResult1 = Row[], TResult2 = never>(
    onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.filteredRows()).then(onfulfilled, onrejected);
  }

  private filteredRows(): Row[] {
    const rows = this.rows().filter((row) => Object.entries(this.conditions).every(
      ([key, value]) => {
        const rowKey = key.split('.').at(-1)!;
        return !(rowKey in row) || row[rowKey] === value;
      },
    ));
    return this.limitCount == null ? rows : rows.slice(0, this.limitCount);
  }
}

describe('opportunity AI drafting data', () => {
  const preferences = new Map<string, Row>();
  const table = vi.fn();

  beforeEach(() => {
    preferences.clear();
    table.mockReset();
    table.mockImplementation((name: string) => {
      if (name === 'user_preferences') {
        return new FakeQuery(
          () => [...preferences.values()],
          (_conditions, inserted, patch) => {
            const key = `${inserted.tenant}:${inserted.user_id}:${inserted.setting_name}`;
            preferences.set(key, { ...inserted, ...patch });
          },
          (conditions) => {
            for (const [key, row] of preferences) {
              if (Object.entries(conditions).every(([field, value]) => row[field] === value)) {
                preferences.delete(key);
              }
            }
          },
        );
      }
      if (name === 'opportunities as o') {
        return new FakeQuery(() => [{
          opportunity_id: '11111111-1111-4111-8111-111111111111',
          opportunity_number: 'OPP-0042',
          title: 'Security assessment and managed services',
          stage: 'proposed',
          last_activity_at: '2026-07-03T12:00:00.000Z',
          client_name: 'Northwind Clinic',
        }]);
      }
      if (name === 'opportunity_evidence') {
        return new FakeQuery(() => [{
          checkpoint: 'assessment',
          detail: 'Assessment service accepted on quote Q-0042',
          recorded_at: '2026-07-01T12:00:00.000Z',
        }]);
      }
      if (name === 'quotes') {
        return new FakeQuery(() => [{ quote_number: 'Q-0042', status: 'accepted' }]);
      }
      if (name === 'interactions') {
        return new FakeQuery(() => [{
          title: 'Reviewed assessment findings with Dana',
          interaction_date: '2026-07-03T12:00:00.000Z',
        }]);
      }
      throw new Error(`Unexpected table ${name}`);
    });
    dbMocks.tenantDb.mockReturnValue({ table, tenantJoin: vi.fn() });
  });

  it('denies drafting cleanly when the tenant AI module is disabled', async () => {
    const assertAiAddOn = vi.fn();
    await expect(assertOpportunityDraftingAccess({}, 'tenant-1', {
      getFeatures: vi.fn().mockResolvedValue({ aiAssistant: false }),
      assertAiAddOn,
    })).rejects.toMatchObject({
      message: 'AI Assistant is not enabled for this tenant.',
      statusCode: 403,
      code: 'AI_ASSISTANT_DISABLED',
    });
    expect(assertAiAddOn).not.toHaveBeenCalled();
  });

  it('creates, updates, reads, and deletes only the addressed user voice profile', async () => {
    const knex = {} as any;
    await saveOpportunityVoiceProfileData(knex, 'tenant-1', 'user-a', {
      sample_emails: ['Hi Dana,\n\nHere is the short version.'],
      steering_instructions: 'Plain and terse.',
    });
    await saveOpportunityVoiceProfileData(knex, 'tenant-1', 'user-b', {
      sample_emails: ['Hello from user B.'],
      steering_instructions: 'Warm.',
    });
    await saveOpportunityVoiceProfileData(knex, 'tenant-1', 'user-a', {
      sample_emails: ['Updated sample.'],
      steering_instructions: 'No exclamation points.',
    });

    expect(await getOpportunityVoiceProfileData(knex, 'tenant-1', 'user-a')).toEqual({
      sample_emails: ['Updated sample.'],
      steering_instructions: 'No exclamation points.',
    });
    expect(await getOpportunityVoiceProfileData(knex, 'tenant-1', 'user-b')).toEqual({
      sample_emails: ['Hello from user B.'],
      steering_instructions: 'Warm.',
    });

    await deleteOpportunityVoiceProfileData(knex, 'tenant-1', 'user-a');
    expect(await getOpportunityVoiceProfileData(knex, 'tenant-1', 'user-a')).toEqual({
      sample_emails: [],
      steering_instructions: '',
    });
    expect((await getOpportunityVoiceProfileData(knex, 'tenant-1', 'user-b')).sample_emails)
      .toEqual(['Hello from user B.']);
  });

  it('assembles deal context once, applies voice and tone, and returns provider text without sending', async () => {
    const knex = {} as any;
    await saveOpportunityVoiceProfileData(knex, 'tenant-1', 'user-a', {
      sample_emails: ['Hi Dana,\n\nTwo quick points.'],
      steering_instructions: 'Use short paragraphs and no exclamation points.',
    });
    const provider = vi.fn().mockResolvedValue(JSON.stringify({
      subject: 'Assessment follow-up',
      body: 'Hi Dana,\n\nTwo quick points from the assessment.',
    }));

    const result = await generateFollowUpDraftData(
      knex,
      'tenant-1',
      '11111111-1111-4111-8111-111111111111',
      'user-a',
      'Slightly more direct',
      provider,
      new Date('2026-07-12T12:00:00.000Z'),
    );

    expect(result).toEqual({
      subject: 'Assessment follow-up',
      body: 'Hi Dana,\n\nTwo quick points from the assessment.',
    });
    const prompt = provider.mock.calls[0][1].map((message: { content: string }) => message.content).join('\n');
    expect(prompt).toContain('Northwind Clinic');
    expect(prompt).toContain('Days since activity: 9');
    expect(prompt).toContain('Q-0042: accepted');
    expect(prompt).toContain('Reviewed assessment findings with Dana');
    expect(prompt).toContain('Use short paragraphs and no exclamation points.');
    expect(prompt).toContain('Per-draft tone: Slightly more direct');
    expect(table.mock.calls.filter(([name]) => name === 'opportunity_evidence')).toHaveLength(1);
    expect(table.mock.calls.filter(([name]) => name === 'quotes')).toHaveLength(1);
    expect(table.mock.calls.filter(([name]) => name === 'interactions')).toHaveLength(1);
  });

  it('logs a human-sent draft as an interaction and advances opportunity activity', async () => {
    const insertInteraction = vi.fn().mockResolvedValue(undefined);
    const updateOpportunityActivity = vi.fn().mockResolvedValue(undefined);
    await logDraftSentData(
      {} as any,
      'tenant-1',
      'opportunity-1',
      'user-a',
      { subject: 'Assessment follow-up', summary: 'Sent the reviewed follow-up to Dana.' },
      new Date('2026-07-12T15:00:00.000Z'),
      {
        getOpportunity: vi.fn().mockResolvedValue({
          opportunity_id: 'opportunity-1',
          client_id: 'client-1',
          contact_id: 'contact-1',
        }),
        getNoteTypeId: vi.fn().mockResolvedValue('note-type'),
        insertInteraction,
        updateOpportunityActivity,
      },
    );

    expect(insertInteraction).toHaveBeenCalledWith(expect.anything(), 'tenant-1', expect.objectContaining({
      opportunity_id: 'opportunity-1',
      client_id: 'client-1',
      contact_name_id: 'contact-1',
      user_id: 'user-a',
      title: 'Follow-up sent: Assessment follow-up',
      notes: 'Sent the reviewed follow-up to Dana.',
      interaction_date: '2026-07-12T15:00:00.000Z',
    }));
    expect(updateOpportunityActivity).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      'opportunity-1',
      '2026-07-12T15:00:00.000Z',
    );
  });
});
