/**
 * The message a failed activity should surface to an operator.
 *
 * An activity error reaches workflow code wrapped: ActivityFailure("Activity
 * task failed") -> ApplicationFailure(original message). Storing the wrapper's
 * message put the literal string "Activity task failed" into
 * entra_sync_run_tenants.error_message, which names neither the cause nor the
 * remedy. The deepest non-empty message in the cause chain is the one the
 * adapter actually wrote for a person.
 */
export function activityFailureMessage(error: unknown, fallback: string): string {
  let message = '';
  let current: unknown = error;
  const seen = new Set<unknown>();

  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (current.message.trim()) {
      message = current.message.trim();
    }
    current = (current as { cause?: unknown }).cause;
  }

  return message || fallback;
}
