import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import knex, { type Knex } from 'knex';
import {
  snapshotConversationFileBytes,
  transferProtectedConversationFile,
} from '../../../../../packages/co-managed/src/protectedConversationFileTransfer';

vi.mock('@alga-psa/db', () => ({
  tenantDb: (trx: any, tenant: string) => ({ table: (table: string) => trx(table).where({ tenant }) }),
}));

const tenant = '11111111-1111-4111-8111-111111111111';
const file = snapshotConversationFileBytes({
  attachmentId: '22222222-2222-4222-8222-222222222222',
  fileName: 'reply.txt', mimeType: 'text/plain', content: Buffer.from('reply bytes'),
});
const binding = {
  tenant, customer_tenant: tenant, ticket_id: '33333333-3333-4333-8333-333333333333',
  actor_tenant: tenant, actor_user_id: '44444444-4444-4444-8444-444444444444',
  thread_id: null, comment_id: null, draft_operation_id: file.attachmentId,
};
const started = new Date('2026-10-17T12:00:00Z');
const uploaded = new Date('2026-10-17T12:02:00Z');

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(started); });
afterEach(() => { vi.useRealTimers(); });

function harness() {
  const compiler = knex({ client: 'pg' });
  let row: any;
  const statements: Knex.Sql[] = [];
  const trx: any = Object.assign((table: string) => {
    const query: any = {
      where: () => query,
      forUpdate: () => query,
      first: async () => row && { ...row },
      insert: (data: any) => ({ onConflict: () => ({ ignore: async () => { row ??= { ...data }; } }) }),
      update: async (data: any) => {
        const statement = compiler(table).where({ tenant, attachment_id: file.attachmentId }).update(data).toSQL();
        statements.push(statement);
        // The distributed-table contract: Citus rejects this expression even
        // though ordinary PostgreSQL accepts it. Compile the actual update.
        if (/clock_timestamp\s*\(/i.test(statement.sql)) {
          throw new Error('functions used in UPDATE queries on distributed tables must not be VOLATILE');
        }
        Object.assign(row, data);
        return 1;
      },
    };
    return query;
  }, { isTransaction: true, raw: compiler.raw.bind(compiler) });
  const assertWriteAuthority = vi.fn(async () => undefined);
  const withAuthority = async (work: any) => work({ trx, assertWriteAuthority });
  const upload = vi.fn(async () => { vi.setSystemTime(uploaded); });
  const complete = vi.fn(async () => ({ ...row }));
  const transfer = () => transferProtectedConversationFile({} as any, file, binding, 'a'.repeat(64), withAuthority, upload, complete);
  return { transfer, upload, complete, assertWriteAuthority, statements, row: () => row, close: () => compiler.destroy() };
}

it('completes a distributed attachment upload with fresh completion timestamps and preserves exact retries', async () => {
  const h = harness();
  try {
    const result = await h.transfer();
    expect(result).toMatchObject({ status: 'ready', ready_at: uploaded, last_activity_at: uploaded, content_hash: file.contentHash });
    expect(h.upload).toHaveBeenCalledExactlyOnceWith(`co-management/${tenant}/${file.attachmentId}`, file.content, file.mimeType);
    expect(h.assertWriteAuthority).toHaveBeenCalledTimes(2);
    expect(h.complete).toHaveBeenCalledOnce();
    expect(h.statements[0].bindings).toContainEqual(started);
    expect(h.statements[1].bindings).toContainEqual(uploaded);

    vi.setSystemTime(new Date('2026-10-17T12:03:00Z'));
    expect(await h.transfer()).toMatchObject({ status: 'ready', ready_at: uploaded });
    expect(h.upload).toHaveBeenCalledOnce();
  } finally { await h.close(); }
});

it('leaves a failed upload pending and completes it on retry without reporting premature readiness', async () => {
  const h = harness();
  h.upload.mockRejectedValueOnce(new Error('storage unavailable'));
  try {
    await expect(h.transfer()).rejects.toThrow('storage unavailable');
    expect(h.row()).toMatchObject({ status: 'pending', last_activity_at: started });
    expect(h.row()).not.toHaveProperty('ready_at');
    expect(h.complete).not.toHaveBeenCalled();
    expect(await h.transfer()).toMatchObject({ status: 'ready', ready_at: uploaded, last_activity_at: uploaded });
    expect(h.upload).toHaveBeenCalledTimes(2);
  } finally { await h.close(); }
});
