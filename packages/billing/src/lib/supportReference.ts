import { randomUUID } from 'node:crypto';

/**
 * Short opaque reference for an unexpected failure. The operator quotes it to
 * support; the same value is written next to the full cause in the server log.
 */
export function newSupportReference(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8);
}
