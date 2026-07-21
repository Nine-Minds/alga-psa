'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import type { IMarketingCaptureForm } from '@alga-psa/types';
import { guardMarketing } from '../lib/guards';
import {
  createFormInternal,
  listFormsInternal,
  updateFormInternal,
} from '../lib/forms';
import { captureFormInputSchema, captureFormUpdateSchema } from '../schemas/marketingSchemas';

export const listCaptureForms = withAuth(async (user, { tenant }): Promise<IMarketingCaptureForm[]> => {
  await guardMarketing(user, tenant, 'read');
  const { knex } = await createTenantKnex();
  return listFormsInternal(knex, tenant);
});

export const createCaptureForm = withAuth(async (user, { tenant }, input: unknown): Promise<IMarketingCaptureForm> => {
  const userId = await guardMarketing(user, tenant, 'manage');
  const data = captureFormInputSchema.parse(input);
  const { knex } = await createTenantKnex();
  return createFormInternal(knex, tenant, data, userId);
});

export const updateCaptureForm = withAuth(async (user, { tenant }, formId: string, input: unknown): Promise<IMarketingCaptureForm> => {
  await guardMarketing(user, tenant, 'manage');
  const data = captureFormUpdateSchema.parse(input);
  const { knex } = await createTenantKnex();
  return updateFormInternal(knex, tenant, formId, data);
});
