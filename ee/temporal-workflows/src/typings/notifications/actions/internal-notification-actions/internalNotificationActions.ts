/**
 * Stub for @alga-psa/notifications/actions/internal-notification-actions/internalNotificationActions
 *
 * At runtime inside the temporal worker container, the real
 * @alga-psa/notifications package is available under packages/.
 * This stub satisfies TypeScript compilation in the Docker build
 * where the full notification package's transitive UI deps are
 * not installed.
 */

import type { Knex } from 'knex';

export async function createNotificationFromTemplateInternal(
  _knex: Knex,
  _request: any
): Promise<any | null> {
  throw new Error('createNotificationFromTemplateInternal stub — should not be called in temporal worker');
}
