'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import type { IMarketingSequence, IMarketingSequenceEnrollment } from '@alga-psa/types';
import { guardMarketing } from '../lib/guards';
import {
  createSequenceInternal,
  enrollContactInternal,
  getSequenceDetailInternal,
  listSequencesInternal,
  unenrollContactInternal,
  updateSequenceInternal,
  type SequenceDetail,
} from '../lib/sequences';
import { enrollContactSchema, sequenceInputSchema, sequenceUpdateSchema } from '../schemas/marketingSchemas';

export const listMarketingSequences = withAuth(async (user, { tenant }): Promise<IMarketingSequence[]> => {
  await guardMarketing(user, tenant, 'read');
  const { knex } = await createTenantKnex();
  return listSequencesInternal(knex, tenant);
});

export const getMarketingSequenceDetail = withAuth(async (user, { tenant }, sequenceId: string): Promise<SequenceDetail | null> => {
  await guardMarketing(user, tenant, 'read');
  const { knex } = await createTenantKnex();
  return getSequenceDetailInternal(knex, tenant, sequenceId);
});

export const createMarketingSequence = withAuth(async (user, { tenant }, input: unknown): Promise<IMarketingSequence> => {
  const userId = await guardMarketing(user, tenant, 'manage');
  const data = sequenceInputSchema.parse(input);
  const { knex } = await createTenantKnex();
  return createSequenceInternal(knex, tenant, data, userId);
});

export const updateMarketingSequence = withAuth(async (user, { tenant }, sequenceId: string, input: unknown): Promise<IMarketingSequence> => {
  await guardMarketing(user, tenant, 'manage');
  const data = sequenceUpdateSchema.parse(input);
  const { knex } = await createTenantKnex();
  return updateSequenceInternal(knex, tenant, sequenceId, data);
});

export const enrollContactInSequence = withAuth(async (user, { tenant }, sequenceId: string, input: unknown): Promise<IMarketingSequenceEnrollment> => {
  const userId = await guardMarketing(user, tenant, 'manage');
  const data = enrollContactSchema.parse(input);
  const { knex } = await createTenantKnex();
  return enrollContactInternal(knex, tenant, sequenceId, data.contact_id, userId);
});

export const unenrollContactFromSequence = withAuth(async (user, { tenant }, enrollmentId: string): Promise<void> => {
  await guardMarketing(user, tenant, 'manage');
  const { knex } = await createTenantKnex();
  return unenrollContactInternal(knex, tenant, enrollmentId);
});
