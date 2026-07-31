import type { WorkflowTaskStatus } from "../../api/workflowTasks";

/**
 * Pure decision logic for a workflow task's claim/complete affordances, extracted from the
 * detail screen so it can be unit tested.
 *
 * Key rule: a task assigned DIRECTLY to the current user needs no claim — the backend
 * completes a task regardless of its claimed status (`submitTaskFormForApi` has no
 * claimed-status guard). Only genuine pool tasks (assigned to a role, or an open pool)
 * use the claim-first flow.
 */

export type WorkflowTaskGatingInput = {
  status: WorkflowTaskStatus;
  /** Users the task is assigned directly to. */
  assignedUsers?: string[] | null;
  /** Who currently holds the claim (null if unclaimed). */
  claimedBy?: string | null;
};

export type WorkflowTaskGating = {
  /** Task is still actionable (pending or claimed). */
  isOpen: boolean;
  /** The current user is a direct assignee. */
  assignedToMe: boolean;
  /** Claimed, and by the current user (or claimer unknown). */
  claimedByMe: boolean;
  /** The completion form may be submitted now — direct assignee, or claimed by me. */
  canComplete: boolean;
  /** Offer "Claim": a pending pool task not directly assigned to me. */
  showClaim: boolean;
  /** Offer "Release": a pool task I've claimed. */
  showUnclaim: boolean;
};

export function workflowTaskGating(
  input: WorkflowTaskGatingInput,
  userId: string | undefined,
): WorkflowTaskGating {
  const { status, assignedUsers, claimedBy } = input;
  const isOpen = status === "pending" || status === "claimed";
  const assignedToMe = !!userId && (assignedUsers ?? []).includes(userId);
  const claimedByMe = status === "claimed" && (claimedBy == null || claimedBy === userId);
  const canComplete = assignedToMe || claimedByMe;

  return {
    isOpen,
    assignedToMe,
    claimedByMe,
    canComplete,
    showClaim: isOpen && !assignedToMe && status === "pending",
    showUnclaim: isOpen && !assignedToMe && claimedByMe,
  };
}
