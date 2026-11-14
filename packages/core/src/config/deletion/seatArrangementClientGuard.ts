import type { Knex } from 'knex';
import { isCapabilityServed } from '../../lib/capability';

/**
 * The one question every involuntary end of a client asks about the co-managed seat shape:
 * does this client still have a live seat arrangement?
 *
 * Deleting, merging away or inactivating such a client would strand the arrangement: its
 * technicians keep their seats and their sign-in, and the allocation that pays for them is never
 * released. All three are refused until the arrangement is ended on purpose.
 *
 * Raw tenant scoping, like the rest of this folder: `@alga-psa/core` cannot depend on
 * `@alga-psa/db`. Gated like the `co-managed` guards beside it: the `co-managed-seat` capability
 * says whether the tenant is served at all (the verdict is cached per tenant), and only then does
 * the live arrangement row decide the refusal. A tenant that is not served pays no statement here
 * and is never refused.
 */
const liveSeatArrangements = (trx: Knex | Knex.Transaction, tenant: string, clientId: string): Knex.QueryBuilder =>
  trx('co_managed_seat_arrangements')
    .where({ 'co_managed_seat_arrangements.tenant': tenant, client_id: clientId, state: 'active' });

/** Live seat arrangements of a client: none or one. Shaped as a deletion dependency count. */
export const countLiveCoManagedSeatArrangementsForClient = async (
  trx: Knex | Knex.Transaction,
  options: { tenant: string; entityId: string }
): Promise<number> => {
  if (!(await isCapabilityServed('co-managed-seat', options.tenant))) return 0;
  const result = await liveSeatArrangements(trx, options.tenant, options.entityId)
    .count<{ count: string }>('* as count')
    .first();
  return Number(result?.count ?? 0);
};

export const CLIENT_HAS_SEAT_ARRANGEMENT_MESSAGE =
  'This client has a co-managed IT seat arrangement. End the arrangement before making the client inactive.';
export const CLIENT_HAS_SEAT_ARRANGEMENT_I18N_KEY = 'msp/clients:errors.client.hasSeatArrangement';

/** A client with a live seat arrangement cannot be made inactive. */
export class ClientSeatArrangementError extends Error {
  readonly code = 'CLIENT_HAS_SEAT_ARRANGEMENT';
  readonly i18nKey = CLIENT_HAS_SEAT_ARRANGEMENT_I18N_KEY;
  constructor() {
    super(CLIENT_HAS_SEAT_ARRANGEMENT_MESSAGE);
    this.name = 'ClientSeatArrangementError';
  }
}

/**
 * What every writer of `clients.is_inactive` calls with its patch, in the transaction that
 * applies it and before the update. A patch that does not set the client inactive is passed
 * through untouched and costs nothing.
 *
 * Locks the client row first. Enabling a seat arrangement holds a share lock on its client to
 * commit, so of an inactivation and an arrangement racing for one client exactly one wins.
 *
 * @throws ClientSeatArrangementError when the client has a live seat arrangement.
 */
export async function assertClientPatchKeepsSeatArrangement(
  trx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  patch: { is_inactive?: unknown },
): Promise<void> {
  if (patch.is_inactive !== true) return;
  if (!(await isCapabilityServed('co-managed-seat', tenant))) return;
  await trx('clients').where({ 'clients.tenant': tenant, client_id: clientId }).forUpdate().first('client_id');
  if (await liveSeatArrangements(trx, tenant, clientId).first('arrangement_id')) throw new ClientSeatArrangementError();
}
