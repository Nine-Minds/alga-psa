/**
 * Admission for scheduled comments. Admits by default; an extension registers a
 * checker that may refuse. The refusal is the checker's to express (throw or
 * return false).
 */

export interface ScheduledCommentAdmissionContext {
  tenant: string;
  ticketId: string;
  userId?: string;
}

export type ScheduledCommentAdmissionChecker = (ctx: ScheduledCommentAdmissionContext) => Promise<boolean> | boolean;

const KEY = '__algaScheduledCommentAdmission';

export function registerScheduledCommentAdmission(checker: ScheduledCommentAdmissionChecker): void {
  (globalThis as Record<string, unknown>)[KEY] = checker;
}

export async function admitScheduledComment(ctx: ScheduledCommentAdmissionContext): Promise<boolean> {
  const checker = (globalThis as Record<string, unknown>)[KEY] as ScheduledCommentAdmissionChecker | undefined;
  return checker ? checker(ctx) : true;
}

/** Test-only. */
export function resetScheduledCommentAdmission(): void {
  delete (globalThis as Record<string, unknown>)[KEY];
}
