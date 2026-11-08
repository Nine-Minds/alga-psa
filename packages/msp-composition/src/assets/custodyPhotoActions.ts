'use server';

import { z } from 'zod';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { permissionError } from '@alga-psa/ui/lib/errorHandling';
import { custodyEventInputSchema } from '@alga-psa/assets/lib/schemas/assetCustody.schema';
import { CustodyError } from '@alga-psa/assets/lib/custody/errors';
import { toCustodyResult } from '@alga-psa/assets/lib/custody/actionResult';
import {
  authorizeCustodyEpisode,
  recordCustodyEventInTransaction,
  publishRecordedCustodyEvent,
} from '@alga-psa/assets/lib/custody/service';
import { withCustodyPhotos } from './withCustodyPhotos';

export const recordCustodyEventWithPhotos = withAuth(
  async (user, { tenant }, custodyId: string, input: unknown, photos: FormData) => {
    if (!(await hasPermission(user, 'asset', 'update'))) {
      return permissionError('Permission denied: Cannot update asset custody', 'msp/assets:errors.permissions.update');
    }
    return toCustodyResult(async () => {
      z.string().guid().parse(custodyId);
      const parsed = custodyEventInputSchema.parse(input);
      if (parsed.document_ids.length)
        throw new CustodyError('permission_denied', 'Existing documents cannot be submitted as custody uploads.');
      const { knex } = await createTenantKnex();
      const custody = await authorizeCustodyEpisode(knex, tenant, user, custodyId);
      const result = await withCustodyPhotos(
        knex,
        tenant,
        user,
        photos,
        [{ entity_type: 'asset', entity_id: custody.asset_id }],
        (trx, documentIds) =>
          recordCustodyEventInTransaction(trx, tenant, user, custodyId, { ...parsed, document_ids: documentIds })
      );
      await publishRecordedCustodyEvent(tenant, user, result);
      return { custody: result.custody, event: result.event };
    });
  }
);
