'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { assertMspPermission } from '../lib/authHelpers';
import {
  searchClientsForPicker as searchClientsForPickerModel,
  type SearchClientsForPickerParams,
  type SearchClientsForPickerResult,
} from '@alga-psa/shared/ticketClients/clientPicker';

export type {
  PickerClient,
  SearchClientsForPickerParams,
  SearchClientsForPickerResult,
} from '@alga-psa/shared/ticketClients/clientPicker';

export const searchClientsForPicker = withAuth(async (
  user,
  { tenant },
  params: SearchClientsForPickerParams = {}
): Promise<SearchClientsForPickerResult> => {
  await assertMspPermission(user, 'client', 'read', 'Permission denied: Cannot read clients');

  const { knex: db } = await createTenantKnex();
  return searchClientsForPickerModel(db, tenant, user, params);
});
