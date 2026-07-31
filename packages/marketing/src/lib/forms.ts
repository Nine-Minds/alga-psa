import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IMarketingCaptureForm } from '@alga-psa/types';
import type { CaptureFormInput } from '../schemas/marketingSchemas';

export async function listFormsInternal(knex: Knex, tenant: string): Promise<IMarketingCaptureForm[]> {
  const db = tenantDb(knex, tenant);
  return db.table('marketing_capture_forms').where({ tenant }).orderBy('created_at', 'desc');
}

export async function getFormBySlugInternal(db: Knex | Knex.Transaction, tenant: string, slug: string): Promise<IMarketingCaptureForm | null> {
  const tdb = tenantDb(db, tenant);
  return (await tdb.table('marketing_capture_forms').where({ tenant, slug, is_active: true }).first()) ?? null;
}

export async function createFormInternal(knex: Knex, tenant: string, input: CaptureFormInput, createdBy: string): Promise<IMarketingCaptureForm> {
  const db = tenantDb(knex, tenant);
  const [row] = await db.table('marketing_capture_forms')
    .insert({
      tenant,
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      campaign_id: input.campaign_id ?? null,
      creates_suggestion: input.creates_suggestion ?? true,
      is_active: input.is_active ?? true,
      created_by: createdBy,
    })
    .returning('*');
  return row;
}

export async function updateFormInternal(knex: Knex, tenant: string, formId: string, input: Partial<CaptureFormInput>): Promise<IMarketingCaptureForm> {
  const db = tenantDb(knex, tenant);
  const { slug: _slug, ...rest } = input;
  const [row] = await db.table('marketing_capture_forms')
    .where({ tenant, form_id: formId })
    .update({ ...rest, updated_at: new Date().toISOString() })
    .returning('*');
  if (!row) throw new Error('Capture form not found');
  return row;
}
