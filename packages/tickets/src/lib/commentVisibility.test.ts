import { describe, expect, it } from 'vitest';
import {
  CLIENT_REDACTED_COMMENT_FIELDS,
  commentVisibleToClient,
  projectCommentsForPrincipal,
  redactCommentForClient,
  tombstoneCommentForClient,
} from './commentVisibility';

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

describe('redactCommentForClient', () => {
  it('removes scheduling columns, Bcc and metadata.email without mutating the source', () => {
    const source: any = {
      ...base,
      metadata: { keep: 1, email: { messageId: 'm' }, email_recipients: { cc: [{ email: 'cc@x' }], bcc: [{ email: 'b@x' }] } },
    };
    for (const f of CLIENT_REDACTED_COMMENT_FIELDS) source[f] = 'x';
    const out: any = redactCommentForClient(source);
    for (const f of CLIENT_REDACTED_COMMENT_FIELDS) expect(out).not.toHaveProperty(f);
    expect(out.metadata.email).toBeUndefined();
    expect(out.metadata.keep).toBe(1);
    expect(JSON.stringify(out.metadata)).not.toContain('b@x');
    expect(JSON.stringify(out.metadata)).toContain('cc@x');
    expect(source.metadata.email).toBeDefined();
    expect(source.schedule_job_id).toBe('x');
  });

  it('nulls unparseable string metadata', () => {
    expect((redactCommentForClient({ ...base, metadata: '{oops' } as any) as any).metadata).toBeNull();
  });
});

describe('tombstoneCommentForClient', () => {
  it('emits exactly the allowlisted keys and never the stored row', () => {
    const out = tombstoneCommentForClient({
      ...base,
      parent_comment_id: 'p',
      created_at: '2026-01-01',
      deleted_at: '2026-01-02',
      user_id: 'u',
      contact_id: 'ct',
      note: 'secret',
      markdown_content: 'secret',
      metadata: { email: { messageId: 'm' } },
      schedule_job_id: 'job',
    } as any);
    expect(Object.keys(out).sort()).toEqual(
      [
        'comment_id', 'thread_id', 'parent_comment_id', 'created_at', 'deleted_at', 'user_id',
        'contact_id', 'is_internal', 'publish_state', 'note', 'markdown_content',
      ].sort(),
    );
    expect(out.note).toBe('[deleted]');
    expect(out.markdown_content).toBe('[deleted]');
    expect(out.is_internal).toBe(false);
  });
});
