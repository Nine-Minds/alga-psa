import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import type { AggregatedReaction, SuccessResponse, TicketComment } from "./tickets";

/** GET/POST /api/v1/projects/tasks/{taskId}/comments resource. */
export type TaskCommentResource = {
  task_comment_id: string;
  task_id: string;
  thread_id?: string | null;
  parent_comment_id?: string | null;
  user_id: string;
  author_type?: string;
  /** BlockNote JSON, the same serialized shape the mobile rich-text editor produces. */
  note: string;
  markdown_content?: string | null;
  created_at: string;
  updated_at?: string | null;
  edited_at?: string | null;
  deleted_at?: string | null;
  author?: { user_id: string; first_name?: string | null; last_name?: string | null; email?: string | null; avatar_url?: string | null } | null;
  reactions?: AggregatedReaction[];
  reaction_user_names?: Record<string, string>;
};

/** Task comments are always internal; the ticket comment shape is what the shared UI renders. */
export function taskCommentToTicketComment(comment: TaskCommentResource): TicketComment {
  const name = [comment.author?.first_name, comment.author?.last_name].filter(Boolean).join(" ").trim();
  return {
    comment_id: comment.task_comment_id,
    comment_text: comment.deleted_at ? "[deleted]" : comment.note,
    is_internal: true,
    created_by: comment.user_id,
    created_by_name: name || comment.author?.email || null,
    created_by_avatar_url: comment.author?.avatar_url ?? null,
    created_at: comment.created_at,
    thread_id: comment.thread_id ?? null,
    parent_comment_id: comment.parent_comment_id ?? null,
    deleted_at: comment.deleted_at ?? null,
    reactions: comment.reactions ?? [],
    reaction_user_names: comment.reaction_user_names ?? {},
    kind: "comment",
  };
}

const headers = (apiKey: string, audit?: Record<string, string | undefined>) => ({ "x-api-key": apiKey, ...audit });

export function getTaskComments(
  client: ApiClient,
  params: { apiKey: string; taskId: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<TaskCommentResource[]>>> {
  return client.request<SuccessResponse<TaskCommentResource[]>>({
    method: "GET",
    path: `/api/v1/projects/tasks/${params.taskId}/comments`,
    signal: params.signal,
    headers: headers(params.apiKey),
  });
}

export function addTaskComment(
  client: ApiClient,
  params: { apiKey: string; taskId: string; note: string; parent_comment_id?: string; auditHeaders?: Record<string, string | undefined> },
): Promise<ApiResult<SuccessResponse<TaskCommentResource>>> {
  return client.request<SuccessResponse<TaskCommentResource>>({
    method: "POST",
    path: `/api/v1/projects/tasks/${params.taskId}/comments`,
    headers: headers(params.apiKey, params.auditHeaders),
    body: { note: params.note, ...(params.parent_comment_id ? { parent_comment_id: params.parent_comment_id } : {}) },
  });
}

export function updateTaskComment(
  client: ApiClient,
  params: { apiKey: string; taskId: string; commentId: string; note: string; auditHeaders?: Record<string, string | undefined> },
): Promise<ApiResult<SuccessResponse<TaskCommentResource>>> {
  return client.request<SuccessResponse<TaskCommentResource>>({
    method: "PUT",
    path: `/api/v1/projects/tasks/${params.taskId}/comments/${params.commentId}`,
    headers: headers(params.apiKey, params.auditHeaders),
    body: { note: params.note },
  });
}

export function deleteTaskComment(
  client: ApiClient,
  params: { apiKey: string; taskId: string; commentId: string; auditHeaders?: Record<string, string | undefined> },
): Promise<ApiResult<unknown>> {
  return client.request<unknown>({
    method: "DELETE",
    path: `/api/v1/projects/tasks/${params.taskId}/comments/${params.commentId}`,
    headers: headers(params.apiKey, params.auditHeaders),
  });
}

export function toggleTaskCommentReaction(
  client: ApiClient,
  params: { apiKey: string; taskId: string; commentId: string; emoji: string },
): Promise<ApiResult<SuccessResponse<{ added: boolean; reactions?: AggregatedReaction[]; reaction_user_names?: Record<string, string> }>>> {
  return client.request<SuccessResponse<{ added: boolean; reactions?: AggregatedReaction[]; reaction_user_names?: Record<string, string> }>>({
    method: "POST",
    path: `/api/v1/projects/tasks/${params.taskId}/comments/${params.commentId}/reactions`,
    headers: headers(params.apiKey),
    body: { emoji: params.emoji },
  });
}
