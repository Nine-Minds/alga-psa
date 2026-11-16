'use client';

import React, { createContext, useContext } from 'react';
import type { CommentAudience } from '@alga-psa/types';

/**
 * Cross-feature slot for the audience a task comment is written to.
 *
 * The audience select is the ticket composer's (`CommentAudienceSelect`, packages/tickets). projects is a vertical
 * feature package and must not import tickets (ESLint `no-feature-to-feature-imports`), so the composition layer
 * (msp-composition) injects it here, as it does for project billing. With no provider mounted (every MSP screen, the
 * client portal, tests) the context is null: the comment form shows no audience control and posts the comment it
 * always posted.
 */
export interface TaskCommentAudienceSlot {
  /** The audiences the author may name. */
  audiences: readonly CommentAudience[];
  /** Renders the existing audience select. */
  renderSelect: (props: {
    id: string;
    audiences: readonly CommentAudience[];
    value: CommentAudience | null;
    onChange: (audience: CommentAudience) => void;
    disabled?: boolean;
  }) => React.ReactNode;
}

const TaskCommentAudienceContext = createContext<TaskCommentAudienceSlot | null>(null);

export function TaskCommentAudienceProvider({ value, children }: { value: TaskCommentAudienceSlot | null; children: React.ReactNode }) {
  return <TaskCommentAudienceContext.Provider value={value}>{children}</TaskCommentAudienceContext.Provider>;
}

export function useTaskCommentAudience(): TaskCommentAudienceSlot | null {
  return useContext(TaskCommentAudienceContext);
}
