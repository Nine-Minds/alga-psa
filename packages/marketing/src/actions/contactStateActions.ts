'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { guardMarketing } from '../lib/guards';
import {
  getContactMarketingProfileInternal,
  type ContactMarketingProfile,
} from '../lib/contactState';

export const getContactMarketingProfile = withAuth(async (user, { tenant }, contactId: string): Promise<ContactMarketingProfile | null> => {
  await guardMarketing(user, tenant, 'read');
  const { knex } = await createTenantKnex();
  return getContactMarketingProfileInternal(knex, tenant, contactId);
});
