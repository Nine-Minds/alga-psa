import { describe, expect, it } from 'vitest';
import { commentVisibleToClient, projectCommentsForPrincipal } from './commentVisibility';

const base = { comment_id: 'c1', thread_id: 't1', author_type: 'internal' as const, is_internal: false, publish_state: 'published' as const, deleted_at: null };
const client = { user_type: 'client' };
const msp = { user_type: 'internal' };

describe('commentVisibleToClient', () => {
  it('shows public published comments', () => expect(commentVisibleToClient(base)).toBe(true));
  it('hides internal comments', () => expect(commentVisibleToClient({ ...base, is_internal: true })).toBe(false));
  it('hides comments in internal threads', () => expect(commentVisibleToClient(base, { is_internal: true })).toBe(false));
  it('hides scheduled and canceled comments', () => {
    expect(commentVisibleToClient({ ...base, publish_state: 'scheduled' })).toBe(false);
    expect(commentVisibleToClient({ ...base, publish_state: 'canceled' })).toBe(false);
  });
  it('hides soft-deleted comments', () => expect(commentVisibleToClient({ ...base, deleted_at: '2026-01-01' })).toBe(false));
});

describe('projectCommentsForPrincipal', () => {
  const rows: any[] = [
    { ...base, comment_id: 'ok', metadata: { responseSource: 'x', email: { provider: 'google' }, email_recipients: { cc: [{ email: 'a@x' }], bcc: [{ email: 'secret@x' }] } }, schedule_job_id: 'job', scheduled_publish_event_id: 'ev' },
    { ...base, comment_id: 'internal', is_internal: true },
    { ...base, comment_id: 'sched', publish_state: 'scheduled' },
    { ...base, comment_id: 'deleted', deleted_at: 'x' },
    { ...base, comment_id: 'inthread', thread_id: 't2' },
  ];
  const threads = new Map([['t2', { is_internal: true }]]);

  it('filters and redacts for client principals', () => {
    const out = projectCommentsForPrincipal(client, rows, threads);
    expect(out.map((c) => c.comment_id)).toEqual(['ok']);
    const ok: any = out[0];
    expect(ok.metadata.email_recipients.bcc).toEqual([]);
    expect(ok.metadata.email_recipients.cc).toEqual([{ email: 'a@x' }]);
    expect(ok.metadata.email).toBeUndefined();
    expect(ok.metadata.responseSource).toBe('x');
    expect(ok.schedule_job_id).toBeUndefined();
    expect(ok.scheduled_publish_event_id).toBeUndefined();
    expect(rows[0].metadata.email_recipients.bcc).toHaveLength(1); // input not mutated
  });

  it('passes MSP rows through unchanged', () => {
    expect(projectCommentsForPrincipal(msp, rows, threads)).toBe(rows);
  });

  it('treats unknown user types as clients (fail closed)', () => {
    expect(projectCommentsForPrincipal({ user_type: undefined }, rows, threads)).toHaveLength(1);
  });
});
