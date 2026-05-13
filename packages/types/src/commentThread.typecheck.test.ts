import { describe, expectTypeOf, it } from 'vitest';

import type { IComment, ICommentThread, IProjectTaskComment } from '@alga-psa/types';

describe('comment thread typing', () => {
  it('T011: exports ICommentThread with the persisted comment_threads field contract', () => {
    expectTypeOf<ICommentThread>().toMatchTypeOf<{
      tenant: string;
      thread_id: string;
      ticket_id: string | null;
      project_task_id: string | null;
      root_comment_id: string;
      is_internal: boolean;
      reply_count: number;
      last_activity_at: string;
      email_message_id: string | null;
      email_references: string[];
      email_provider_thread_id: string | null;
      created_at: string;
      created_by: string | null;
    }>();
  });

  it('T012: exposes ticket comment threading fields on IComment create/read payloads', () => {
    expectTypeOf<IComment['thread_id']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<IComment['parent_comment_id']>().toEqualTypeOf<string | null | undefined>();
    expectTypeOf<IComment['deleted_at']>().toEqualTypeOf<string | null | undefined>();
  });

  it('T013: exposes task comment threading fields on IProjectTaskComment payloads', () => {
    expectTypeOf<IProjectTaskComment['threadId']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<IProjectTaskComment['parentCommentId']>().toEqualTypeOf<string | null | undefined>();
    expectTypeOf<IProjectTaskComment['deletedAt']>().toEqualTypeOf<string | null | undefined>();
  });
});
