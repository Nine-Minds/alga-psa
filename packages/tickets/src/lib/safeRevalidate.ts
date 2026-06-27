import { revalidatePath as nextRevalidatePath } from 'next/cache';

/**
 * `revalidatePath` throws "Invariant: static generation store missing" when called
 * outside a Next.js request context — e.g. from background jobs such as the
 * `auto-close-tickets` maintenance cycle, which closes tickets via the same shared
 * actions that a UI request would. Cache invalidation is best-effort, so swallow
 * that specific case instead of failing the underlying ticket operation.
 */
export function safeRevalidatePath(path: string, type?: 'layout' | 'page'): void {
  try {
    nextRevalidatePath(path, type as never);
  } catch {
    // Not in a request context (background job / cron) — skip cache revalidation.
  }
}
