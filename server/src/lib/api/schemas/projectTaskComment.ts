/**
 * Project Task Comment API Schemas
 */

import { z } from 'zod';
import { uuidSchema } from './common';

const noteSchema = z.string().trim().min(1, 'note is required');

export const createProjectTaskCommentSchema = z.object({
  /** BlockNote JSON, as the web composer produces it. */
  note: noteSchema,
  parent_comment_id: uuidSchema.nullable().optional(),
}).strict();

export const updateProjectTaskCommentSchema = z.object({
  note: noteSchema,
}).strict();

export const toggleProjectTaskCommentReactionSchema = z.object({
  emoji: z.string().min(1, 'emoji is required').max(50, 'emoji is too long'),
}).strict();

const aggregatedReactionSchema = z.object({
  emoji: z.string(),
  count: z.number().int(),
  userIds: z.array(uuidSchema),
  currentUserReacted: z.boolean(),
});

export const projectTaskCommentAuthorSchema = z.object({
  user_id: uuidSchema,
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  email: z.string().nullable(),
  avatar_url: z.string().nullable(),
});

export const projectTaskCommentResponseSchema = z.object({
  task_comment_id: uuidSchema,
  task_id: uuidSchema,
  thread_id: uuidSchema.nullable(),
  parent_comment_id: uuidSchema.nullable(),
  user_id: uuidSchema,
  author_type: z.literal('internal'),
  /** BlockNote JSON; "[deleted]" once soft-deleted. */
  note: z.string(),
  markdown_content: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
  edited_at: z.string().nullable(),
  deleted_at: z.string().nullable(),
  author: projectTaskCommentAuthorSchema.nullable(),
  reactions: z.array(aggregatedReactionSchema),
  reaction_user_names: z.record(z.string()),
});

export const projectTaskCommentReactionResponseSchema = z.object({
  added: z.boolean(),
  reactions: z.array(aggregatedReactionSchema),
  reaction_user_names: z.record(z.string()),
});

export type CreateProjectTaskCommentData = z.infer<typeof createProjectTaskCommentSchema>;
export type UpdateProjectTaskCommentData = z.infer<typeof updateProjectTaskCommentSchema>;
export type ProjectTaskCommentResponse = z.infer<typeof projectTaskCommentResponseSchema>;
export type ProjectTaskCommentReactionResponse = z.infer<typeof projectTaskCommentReactionResponseSchema>;
