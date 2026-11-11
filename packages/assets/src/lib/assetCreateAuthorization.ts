import type { Knex } from 'knex';
import { assertRecordCreateAllowed } from '@alga-psa/authorization/recordCreateAuthorization';
import type { SubjectUserInput } from '@alga-psa/authorization/subject';

/** The create gate for MSP asset creation: the candidate asset's client is judged by the asset read rules. */
export async function assertAssetCreateAllowed(
  trx: Knex.Transaction,
  tenant: string,
  user: SubjectUserInput,
  clientId: string | null | undefined,
): Promise<void> {
  await assertRecordCreateAllowed(trx, {
    tenant,
    user,
    resourceType: 'asset',
    record: { clientId: clientId ?? null },
  }, 'assets');
}
