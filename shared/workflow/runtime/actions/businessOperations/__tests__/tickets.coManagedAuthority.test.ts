import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { coManagedWorkflowTicketSeam } from '../../../../../lib/coManagedDelivery';
import { retainWorkflowTicketAuthority } from '../shared';

const ctx = { runId: 'run-1', stepPath: 'a.b' } as any;
const tx = { tenantId: 'tenant-1', trx: { marker: 'trx' }, actorUserId: 'user-1' } as any;

describe('workflow ticket mutation adapter (L4a workflowTicketAuthority)', () => {
  const original = process.env.FORCE_CAPABILITIES;
  beforeEach(() => coManagedWorkflowTicketSeam.reset());
  afterEach(() => { coManagedWorkflowTicketSeam.reset(); process.env.FORCE_CAPABILITIES = original ?? ''; });

  it('costs nothing and calls nothing when no provider is registered (flag off / package absent)', async () => {
    await expect(retainWorkflowTicketAuthority(ctx, tx, 't1', ['comments'])).resolves.toBeUndefined();
  });

  it('does not construct the provider for a tenant that is not served', async () => {
    const factory = vi.fn(() => { throw new Error('must not be built'); });
    coManagedWorkflowTicketSeam.register(factory);
    process.env.FORCE_CAPABILITIES = 'co-managed:off';
    await retainWorkflowTicketAuthority(ctx, tx, 't1', ['status_id']);
    expect(factory).not.toHaveBeenCalled();
  });

  it('retains run / author authority inside the action transaction for a served tenant, and publishes nothing', async () => {
    const retain = vi.fn(async () => undefined);
    coManagedWorkflowTicketSeam.register(() => ({ retain }) as any);
    process.env.FORCE_CAPABILITIES = 'co-managed:on';
    await retainWorkflowTicketAuthority(ctx, tx, 't1', ['assignment']);
    expect(retain).toHaveBeenCalledWith(tx.trx, { tenant: 'tenant-1', ticketId: 't1', workflowRunId: 'run-1', actorUserId: 'user-1', fields: ['assignment'], readFields: [] });
  });

  it('DO-NOT-PORT #2: the adapter publishes no event, and add_comment still publishes only for explicit Cc/Bcc (base behaviour)', () => {
    const adapter = readFileSync(join(__dirname, '../shared.ts'), 'utf8').split('export async function retainWorkflowTicketAuthority')[1];
    expect(adapter).not.toMatch(/publish|TICKET_COMMENT_ADDED|getEventBus/);
    const tickets = readFileSync(join(__dirname, '../tickets.ts'), 'utf8');
    expect(tickets).toContain('hasEmailRecipients ? workflowCommentEventPublisher : undefined');
    expect(tickets.match(/workflowCommentEventPublisher/g)).toHaveLength(2);
  });
});
