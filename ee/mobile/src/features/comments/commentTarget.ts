import type { ApiClient } from "../../api/client";
import type { ApiResult } from "../../api/types";
import type { SuccessResponse, TicketComment } from "../../api/tickets";
import {
  addTicketComment,
  cancelScheduledTicketComment,
  getTicketComments,
  toggleCommentReaction,
  updateTicketComment,
} from "../../api/tickets";
import {
  addTaskComment,
  deleteTaskComment,
  getTaskComments,
  taskCommentToTicketComment,
  toggleTaskCommentReaction,
  updateTaskComment,
} from "../../api/projectTaskComments";

/** What a comment thread hangs off. The shared comment UI renders the ticket shape for both. */
export type CommentTarget =
  | { kind: "ticket"; ticketId: string }
  | { kind: "project_task"; taskId: string };

export function ticketTarget(ticketId: string): CommentTarget {
  return { kind: "ticket", ticketId };
}

export function taskTarget(taskId: string): CommentTarget {
  return { kind: "project_task", taskId };
}

export function commentTargetId(target: CommentTarget): string {
  return target.kind === "ticket" ? target.ticketId : target.taskId;
}

/** Offline draft storage key; one draft per user per thread. */
export function commentDraftKey(target: CommentTarget, userId: string | null | undefined): string {
  const who = userId ?? "anonymous";
  return target.kind === "ticket"
    ? `alga.mobile.ticketDraft.${who}.${target.ticketId}`
    : `alga.mobile.taskDraft.${who}.${target.taskId}`;
}

type Audit = Record<string, string | undefined> | undefined;

export type CommentApi = {
  list(client: ApiClient, params: { apiKey: string; signal?: AbortSignal }): Promise<ApiResult<SuccessResponse<TicketComment[]>>>;
  add(
    client: ApiClient,
    params: {
      apiKey: string;
      comment_text: string;
      is_internal: boolean;
      is_resolution?: boolean;
      parent_comment_id?: string;
      scheduled_publish_at?: string;
      scheduled_publish_tz?: string;
      /** Ticket comments only: one-off Cc/Bcc for this comment's email. */
      cc?: string[];
      bcc?: string[];
      auditHeaders?: Audit;
    },
  ): Promise<ApiResult<SuccessResponse<TicketComment>>>;
  update(client: ApiClient, params: { apiKey: string; commentId: string; comment_text: string; auditHeaders?: Audit }): Promise<ApiResult<unknown>>;
  toggleReaction(client: ApiClient, params: { apiKey: string; commentId: string; emoji: string }): Promise<ApiResult<unknown>>;
  /** Only tickets schedule comments. */
  cancelScheduled?: (client: ApiClient, params: { apiKey: string; commentId: string; auditHeaders?: Audit }) => Promise<ApiResult<unknown>>;
  /** Only where the API deletes comments (tasks). */
  remove?: (client: ApiClient, params: { apiKey: string; commentId: string; auditHeaders?: Audit }) => Promise<ApiResult<unknown>>;
  /** Tickets separate internal and client comments; task comments are always internal. */
  supportsVisibility: boolean;
};

export function createCommentApi(target: CommentTarget): CommentApi {
  if (target.kind === "ticket") {
    const { ticketId } = target;
    return {
      supportsVisibility: true,
      list: (client, params) => getTicketComments(client, { apiKey: params.apiKey, ticketId }),
      add: (client, params) => addTicketComment(client, { ...params, ticketId }),
      update: (client, params) => updateTicketComment(client, { ...params, ticketId }),
      toggleReaction: (client, params) => toggleCommentReaction(client, { ...params, ticketId }),
      cancelScheduled: (client, params) => cancelScheduledTicketComment(client, { ...params, ticketId }),
    };
  }
  const { taskId } = target;
  return {
    supportsVisibility: false,
    list: async (client, params) => {
      const result = await getTaskComments(client, { apiKey: params.apiKey, taskId, signal: params.signal });
      if (!result.ok) return result;
      return { ...result, data: { ...result.data, data: (result.data.data ?? []).map(taskCommentToTicketComment) } };
    },
    add: async (client, params) => {
      const result = await addTaskComment(client, {
        apiKey: params.apiKey,
        taskId,
        note: params.comment_text,
        parent_comment_id: params.parent_comment_id,
        auditHeaders: params.auditHeaders,
      });
      if (!result.ok) return result;
      return { ...result, data: { ...result.data, data: taskCommentToTicketComment(result.data.data) } };
    },
    update: (client, params) => updateTaskComment(client, { apiKey: params.apiKey, taskId, commentId: params.commentId, note: params.comment_text, auditHeaders: params.auditHeaders }),
    toggleReaction: (client, params) => toggleTaskCommentReaction(client, { ...params, taskId }),
    remove: (client, params) => deleteTaskComment(client, { ...params, taskId }),
  };
}
