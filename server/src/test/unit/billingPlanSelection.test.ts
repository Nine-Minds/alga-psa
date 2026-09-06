import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenantKnex } from 'server/src/lib/db';
import { getEligibleContractLinesForUI } from 'server/src/lib/utils/contractLineDisambiguation';

// Only database I/O is substituted. SQL eligibility and browser selection have
// separate DB/E2E suites; these assertions exercise the real UI projection.
vi.mock('server/src/lib/db', () => ({ createTenantKnex: vi.fn() }));
const line = (overrides: Record<string, unknown> = {}) => ({
  client_contract_line_id: 'line-1', contract_line_name: 'Support hours',
  contract_line_type: 'Hourly', contract_name: 'Managed services',
  start_date: new Date('2026-01-01T00:00:00Z'), end_date: null, ...overrides,
});

describe('Contract line choices returned to the UI', () => {
  let rows: ReturnType<typeof vi.fn>;
  let service: ReturnType<typeof vi.fn>;
  let database: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    rows = vi.fn().mockResolvedValue([]);
    service = vi.fn().mockResolvedValue({ category_id: null, service_type_id: 'hourly' });
    const catalog = { where: vi.fn().mockReturnThis(), first: service };
    const query = { where: vi.fn().mockReturnThis(), join: vi.fn().mockReturnThis(), leftJoin: vi.fn().mockReturnThis(), select: rows };
    database = vi.fn((table: string) => {
      if (table === 'service_catalog') return catalog;
      if (table === 'client_contracts') return query;
      throw new Error(`Unexpected table: ${table}`);
    });
    vi.mocked(createTenantKnex).mockResolvedValue({ knex: database, tenant: 'tenant-1' } as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns identity, labels and hydrated dates for a single choice', async () => {
    rows.mockResolvedValue([line({ end_date: new Date('2027-01-01T00:00:00Z') })]);
    const choices = await getEligibleContractLinesForUI('client-1', 'service-1');
    expect(choices).toEqual([{
      client_contract_line_id: 'line-1', contract_line_name: 'Support hours',
      contract_line_type: 'Hourly', contract_name: 'Managed services',
      start_date: expect.any(String), end_date: expect.any(String),
      has_bucket_overlay: false, bucket_overlay: undefined,
    }]);
    expect(new Date(choices[0].start_date).toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(new Date(choices[0].end_date!).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('retains every choice and distinguishes explicit-member, catch-all and absent buckets', async () => {
    rows.mockResolvedValue([
      line(),
      line({ client_contract_line_id: 'line-2', member_bucket_id: 'member-pool', catch_all_bucket_id: 'fallback-pool' }),
      line({ client_contract_line_id: 'line-3', catch_all_bucket_id: 'catch-all-pool' }),
    ]);
    const choices = await getEligibleContractLinesForUI('client-1', 'service-1');
    expect(choices.map(choice => ({ id: choice.client_contract_line_id, bucket: choice.bucket_overlay?.config_id, hasBucket: choice.has_bucket_overlay }))).toEqual([
      { id: 'line-1', bucket: undefined, hasBucket: false },
      { id: 'line-2', bucket: 'member-pool', hasBucket: true },
      { id: 'line-3', bucket: 'catch-all-pool', hasBucket: true },
    ]);
  });

  it('supplies a readable fallback and open-ended dates for an unnamed line', async () => {
    rows.mockResolvedValue([line({ contract_line_name: '', start_date: null })]);
    expect(await getEligibleContractLinesForUI('client-1', 'service-1')).toEqual([
      expect.objectContaining({ contract_line_name: 'Unnamed Contract Line', start_date: '', end_date: null }),
    ]);
  });

  it('preserves legacy overlay details without inventing a bucket for an empty configuration', async () => {
    const overlay = { config_id: 'legacy-pool', total_minutes: 120, overage_rate: 15000, allow_rollover: true };
    rows.mockResolvedValue([line({ bucket_overlay: overlay }), line({ bucket_overlay: { config_id: '' } })]);
    const choices = await getEligibleContractLinesForUI('client-1', 'service-1');
    expect(choices[0]).toMatchObject({ has_bucket_overlay: true, bucket_overlay: overlay });
    expect(choices[1].has_bucket_overlay).toBe(false);
  });

  // Retain the pre-existing input-validation backlog until its DB behavior is verified.
  it.todo('should handle the case when no client ID is available');

  it('returns no choices when no eligible rows exist', async () => {
    expect(await getEligibleContractLinesForUI('client-1', 'service-1')).toEqual([]);
  });

  it('returns no choices for a missing service even if contract rows would exist', async () => {
    service.mockResolvedValue(undefined);
    rows.mockResolvedValue([line()]);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await getEligibleContractLinesForUI('client-1', 'unknown-service')).toEqual([]);
  });

  it('rejects missing tenant context before touching tenant data', async () => {
    vi.mocked(createTenantKnex).mockResolvedValue({ knex: database, tenant: undefined } as never);
    await expect(getEligibleContractLinesForUI('client-1', 'service-1')).rejects.toThrow('Tenant context not found');
    expect(database).not.toHaveBeenCalled();
  });

  it('does not return stale choices after a database failure', async () => {
    rows.mockResolvedValueOnce([line()]).mockRejectedValueOnce(new Error('Database unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await getEligibleContractLinesForUI('client-1', 'service-1')).toHaveLength(1);
    expect(await getEligibleContractLinesForUI('client-1', 'service-1')).toEqual([]);
  });
});
