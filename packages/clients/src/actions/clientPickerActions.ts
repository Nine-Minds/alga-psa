'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { assertMspPermission } from '../lib/authHelpers';
import { attachDisplayTags } from '../lib/displayTags';
import {
  searchClientsForPicker as searchClientsForPickerModel,
  type PickerClientWithDisplayTags,
  type SearchClientsForPickerParams,
  type TaggedSearchClientsForPickerResult,
} from '@alga-psa/shared/ticketClients/clientPicker';

export type {
  PickerClientWithDisplayTags,
  SearchClientsForPickerParams,
  SearchClientsForPickerResult,
  TaggedSearchClientsForPickerResult,
} from '@alga-psa/shared/ticketClients/clientPicker';

/** A picker row as this action returns it (model row + the viewer's chip tags). */
export type PickerClient = PickerClientWithDisplayTags;

export const searchClientsForPicker = withAuth(async (
  user,
  { tenant },
  params: SearchClientsForPickerParams = {}
): Promise<TaggedSearchClientsForPickerResult> => {
  await assertMspPermission(user, 'client', 'read', 'Permission denied: Cannot read clients');

  const { knex: db } = await createTenantKnex();

  const { clients, total } = await searchClientsForPickerModel(db, tenant, user, params);
  // The query model stops at the row; chip tags are a display-rule concern attached here.
  const withTags = await attachDisplayTags(db, tenant, user, 'client', clients, (c) => c.client_id);

  return { clients: withTags, total };
});
