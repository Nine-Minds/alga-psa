import logger from '@alga-psa/core/logger';

/**
 * Builds data an email can do without (a detail block, a change list, an author name).
 * A failure is logged and `fallback` is used, so optional data never costs the email itself.
 */
export async function optionalEmailData<T>(
  label: string,
  fallback: T,
  build: () => Promise<T> | T,
  meta: Record<string, unknown> = {},
): Promise<T> {
  try {
    return await build();
  } catch (error) {
    logger.error(`[TicketEmail] Could not build ${label}; sending without it`, {
      ...meta,
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}
