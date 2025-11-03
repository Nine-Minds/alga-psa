"use server";

import { withTransaction } from '@alga-psa/shared/db';
import type { Knex } from 'knex';
import { z } from 'zod';

import { createTenantKnex, runWithTenant } from '../db';
import { getCurrentUser } from './user-actions/userActions';
import type { IBoard } from 'server/src/interfaces/board.interface';
import type { IPriority } from 'server/src/interfaces/ticket.interfaces';
import type { IStatus } from 'server/src/interfaces/status.interface';
import { getAllBoards } from 'server/src/lib/actions/board-actions/boardActions';
import { getTicketStatuses } from 'server/src/lib/actions/status-actions/statusActions';
import { getAllPriorities } from 'server/src/lib/actions/priorityActions';

const SURVEY_TEMPLATE_TABLE = 'survey_templates';
const SURVEY_TRIGGER_TABLE = 'survey_triggers';

const ratingTypeSchema = z.enum(['stars', 'numbers', 'emojis']);
const ratingScaleSchema = z.union([z.literal(3), z.literal(5), z.literal(10)]);
const ratingLabelsSchema = z
  .record(z.union([z.string(), z.number()]), z.string().min(1))
  .transform((value) => {
    const entries = Object.entries(value);
    return entries.reduce<Record<string, string>>((acc, [key, label]) => {
      acc[String(key)] = label;
      return acc;
    }, {});
  })
  .optional();

const baseTemplateSchema = z.object({
  templateName: z.string().min(1).max(255),
  ratingType: ratingTypeSchema.default('stars'),
  ratingScale: ratingScaleSchema.default(5),
  ratingLabels: ratingLabelsSchema,
  promptText: z.string().min(1).default('How would you rate your support experience?'),
  commentPrompt: z.string().min(1).default('Additional comments (optional)'),
  thankYouText: z.string().min(1).default('Thank you for your feedback!'),
  isDefault: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

const updateTemplateSchema = baseTemplateSchema.partial().extend({
  templateId: z.string().uuid().optional(),
});

const triggerConditionsSchema = z
  .object({
    board_id: z.array(z.string().uuid()).optional(),
    status_id: z.array(z.string().uuid()).optional(),
    priority: z.array(z.string()).optional(),
  })
  .optional();

const baseTriggerSchema = z.object({
  templateId: z.string().uuid(),
  triggerType: z.enum(['ticket_closed', 'project_completed']),
  triggerConditions: triggerConditionsSchema,
  enabled: z.boolean().optional(),
});

const updateTriggerSchema = baseTriggerSchema.partial().extend({
  triggerId: z.string().uuid(),
});

type CreateTemplateInput = z.input<typeof baseTemplateSchema>;
type UpdateTemplateInput = z.input<typeof updateTemplateSchema>;
type CreateTriggerInput = z.input<typeof baseTriggerSchema>;
type UpdateTriggerInput = z.input<typeof updateTriggerSchema>;

type TemplateRow = {
  template_id: string;
  tenant: string;
  template_name: string;
  is_default: boolean;
  rating_type: string;
  rating_scale: number;
  rating_labels: Record<string, string> | string | null;
  prompt_text: string;
  comment_prompt: string;
  thank_you_text: string;
  enabled: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

type TriggerRow = {
  trigger_id: string;
  tenant: string;
  template_id: string;
  trigger_type: string;
  trigger_conditions: Record<string, unknown> | string | null;
  enabled: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

export type SurveyTemplate = {
  templateId: string;
  templateName: string;
  isDefault: boolean;
  ratingType: 'stars' | 'numbers' | 'emojis';
  ratingScale: number;
  ratingLabels: Record<string, string>;
  promptText: string;
  commentPrompt: string;
  thankYouText: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type SurveyTriggerConditions = {
  board_id?: string[];
  status_id?: string[];
  priority?: string[];
};

export type SurveyTrigger = {
  triggerId: string;
  templateId: string;
  triggerType: 'ticket_closed' | 'project_completed';
  triggerConditions: SurveyTriggerConditions;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export async function getSurveyTemplates(): Promise<SurveyTemplate[]> {
  const { knex, tenant } = await createTenantKnex();
  const tenantId = ensureTenant(tenant);

  const rows = await knex<TemplateRow>(SURVEY_TEMPLATE_TABLE)
    .where({ tenant: tenantId })
    .orderBy('template_name', 'asc');

  return rows.map(mapTemplateRow);
}

export async function getSurveyTemplateById(templateId: string): Promise<SurveyTemplate | null> {
  const { knex, tenant } = await createTenantKnex();
  const tenantId = ensureTenant(tenant);

  const row = await knex<TemplateRow>(SURVEY_TEMPLATE_TABLE)
    .where({ tenant: tenantId, template_id: templateId })
    .first();

  return row ? mapTemplateRow(row) : null;
}

export async function createSurveyTemplate(input: CreateTemplateInput): Promise<SurveyTemplate> {
  await ensureAuthenticatedUser();
  const parsed = baseTemplateSchema.parse(input);
  const { knex, tenant } = await createTenantKnex();
  const tenantId = ensureTenant(tenant);

  const inserted = await withTransaction(knex, async (trx) => {
    if (parsed.isDefault) {
      await trx(SURVEY_TEMPLATE_TABLE)
        .where({ tenant: tenantId })
        .update({ is_default: false, updated_at: trx.fn.now() });
    }

    const payload = buildTemplateInsertPayload(trx, tenantId, parsed);
    const [row] = await trx<TemplateRow>(SURVEY_TEMPLATE_TABLE)
      .insert(payload)
      .returning('*');

    if (!row) {
      throw new Error('Failed to create survey template');
    }

    return row;
  });

  return mapTemplateRow(inserted);
}

export async function updateSurveyTemplate(templateId: string, input: UpdateTemplateInput): Promise<SurveyTemplate> {
  await ensureAuthenticatedUser();
  const parsed = updateTemplateSchema.parse(input);
  const { knex, tenant } = await createTenantKnex();
  const tenantId = ensureTenant(tenant);

  const updated = await withTransaction(knex, async (trx) => {
    const current = await trx<TemplateRow>(SURVEY_TEMPLATE_TABLE)
      .where({ tenant: tenantId, template_id: templateId })
      .first()
      .forUpdate();

    if (!current) {
      throw new Error('Survey template not found');
    }

    if (parsed.isDefault) {
      await trx(SURVEY_TEMPLATE_TABLE)
        .where({ tenant: tenantId })
        .update({ is_default: false, updated_at: trx.fn.now() });
    }

    const updatePayload = buildTemplateUpdatePayload(trx, parsed);
    await trx(SURVEY_TEMPLATE_TABLE)
      .where({ tenant: tenantId, template_id: templateId })
      .update(updatePayload);

    const refreshed = await trx<TemplateRow>(SURVEY_TEMPLATE_TABLE)
      .where({ tenant: tenantId, template_id: templateId })
      .first();

    if (!refreshed) {
      throw new Error('Failed to load updated survey template');
    }

    return refreshed;
  });

  return mapTemplateRow(updated);
}

export async function deleteSurveyTemplate(templateId: string): Promise<void> {
  await ensureAuthenticatedUser();
  const { knex, tenant } = await createTenantKnex();
  const tenantId = ensureTenant(tenant);

  const deleted = await knex(SURVEY_TEMPLATE_TABLE)
    .where({ tenant: tenantId, template_id: templateId })
    .del();

  if (deleted === 0) {
    throw new Error('Survey template not found');
  }
}

export async function getSurveyTriggers(): Promise<SurveyTrigger[]> {
  const { knex, tenant } = await createTenantKnex();
  const tenantId = ensureTenant(tenant);

  const rows = await knex<TriggerRow>(SURVEY_TRIGGER_TABLE)
    .where({ tenant: tenantId })
    .orderBy('created_at', 'asc');

  return rows.map(mapTriggerRow);
}

export async function getSurveyTriggersForTenant(
  tenantId: string,
  connection?: Knex | Knex.Transaction
): Promise<SurveyTrigger[]> {
  return runWithTenant(tenantId, async () => {
    const knex = connection ?? (await createTenantKnex()).knex;
    const rows = await knex<TriggerRow>(SURVEY_TRIGGER_TABLE)
      .where({ tenant: tenantId })
      .orderBy('created_at', 'asc');

    return rows.map(mapTriggerRow);
  });
}

export async function createSurveyTrigger(input: CreateTriggerInput): Promise<SurveyTrigger> {
  await ensureAuthenticatedUser();
  const parsed = baseTriggerSchema.parse(input);
  const { knex, tenant } = await createTenantKnex();
  const tenantId = ensureTenant(tenant);

  const row = await withTransaction(knex, async (trx) => {
    await assertTemplateBelongsToTenant(trx, tenantId, parsed.templateId);

    const [created] = await trx<TriggerRow>(SURVEY_TRIGGER_TABLE)
      .insert({
        tenant: tenantId,
        template_id: parsed.templateId,
        trigger_type: parsed.triggerType,
        trigger_conditions: parsed.triggerConditions ?? {},
        enabled: parsed.enabled ?? true,
      })
      .returning('*');

    if (!created) {
      throw new Error('Failed to create survey trigger');
    }

    return created;
  });

  return mapTriggerRow(row);
}

export async function updateSurveyTrigger(triggerId: string, input: UpdateTriggerInput): Promise<SurveyTrigger> {
  await ensureAuthenticatedUser();
  const parsed = updateTriggerSchema.parse({ ...input, triggerId });
  const { knex, tenant } = await createTenantKnex();
  const tenantId = ensureTenant(tenant);

  const updated = await withTransaction(knex, async (trx) => {
    const current = await trx<TriggerRow>(SURVEY_TRIGGER_TABLE)
      .where({ tenant: tenantId, trigger_id: triggerId })
      .first()
      .forUpdate();

    if (!current) {
      throw new Error('Survey trigger not found');
    }

    if (parsed.templateId) {
      await assertTemplateBelongsToTenant(trx, tenantId, parsed.templateId);
    }

    const updatePayload: Record<string, unknown> = {
      updated_at: trx.fn.now(),
    };

    if (parsed.templateId) {
      updatePayload.template_id = parsed.templateId;
    }
    if (parsed.triggerType) {
      updatePayload.trigger_type = parsed.triggerType;
    }
    if (parsed.triggerConditions) {
      updatePayload.trigger_conditions = parsed.triggerConditions;
    }
    if (typeof parsed.enabled === 'boolean') {
      updatePayload.enabled = parsed.enabled;
    }

    await trx(SURVEY_TRIGGER_TABLE)
      .where({ tenant: tenantId, trigger_id: triggerId })
      .update(updatePayload);

    const refreshed = await trx<TriggerRow>(SURVEY_TRIGGER_TABLE)
      .where({ tenant: tenantId, trigger_id: triggerId })
      .first();

    if (!refreshed) {
      throw new Error('Failed to load updated survey trigger');
    }

    return refreshed;
  });

  return mapTriggerRow(updated);
}

export async function deleteSurveyTrigger(triggerId: string): Promise<void> {
  await ensureAuthenticatedUser();
  const { knex, tenant } = await createTenantKnex();
  const tenantId = ensureTenant(tenant);

  const deleted = await knex(SURVEY_TRIGGER_TABLE)
    .where({ tenant: tenantId, trigger_id: triggerId })
    .del();

  if (deleted === 0) {
    throw new Error('Survey trigger not found');
  }
}

function ensureTenant(tenant: string | null): string {
  if (!tenant) {
    throw new Error('Tenant context is required');
  }
  return tenant;
}

async function ensureAuthenticatedUser(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User must be authenticated to perform this action');
  }
}

function mapTemplateRow(row: TemplateRow): SurveyTemplate {
  return {
    templateId: row.template_id,
    templateName: row.template_name,
    isDefault: row.is_default,
    ratingType: row.rating_type as SurveyTemplate['ratingType'],
    ratingScale: row.rating_scale,
    ratingLabels: normaliseLabels(row.rating_labels),
    promptText: row.prompt_text,
    commentPrompt: row.comment_prompt,
    thankYouText: row.thank_you_text,
    enabled: row.enabled,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapTriggerRow(row: TriggerRow): SurveyTrigger {
  return {
    triggerId: row.trigger_id,
    templateId: row.template_id,
    triggerType: row.trigger_type as SurveyTrigger['triggerType'],
    triggerConditions: normaliseTriggerConditions(row.trigger_conditions),
    enabled: row.enabled,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function normaliseLabels(input: TemplateRow['rating_labels']): Record<string, string> {
  if (!input) {
    return {};
  }

  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return typeof parsed === 'object' && parsed !== null ? normaliseLabels(parsed) : {};
    } catch (_error) {
      return {};
    }
  }

  return Object.entries(input).reduce<Record<string, string>>((acc, [key, value]) => {
    acc[String(key)] = typeof value === 'string' ? value : String(value ?? '');
    return acc;
  }, {});
}

function normaliseTriggerConditions(
  value: TriggerRow['trigger_conditions']
): SurveyTriggerConditions {
  if (!value) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return normaliseTriggerConditions(parsed);
    } catch (_error) {
      return {};
    }
  }

  const conditions: SurveyTriggerConditions = {};

  if (Array.isArray(value.board_id)) {
    conditions.board_id = value.board_id.filter(isNonEmptyString);
  }
  if (Array.isArray(value.status_id)) {
    conditions.status_id = value.status_id.filter(isNonEmptyString);
  }
  if (Array.isArray(value.priority)) {
    conditions.priority = value.priority.filter(isNonEmptyString);
  }

  return conditions;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function toDate(input: Date | string): Date {
  return input instanceof Date ? input : new Date(input);
}

export interface SurveyTriggerReferenceData {
  boards: IBoard[];
  statuses: IStatus[];
  priorities: IPriority[];
}

export async function getSurveyTriggerReferenceData(): Promise<SurveyTriggerReferenceData> {
  const [boards, statuses, priorities] = await Promise.all([
    getAllBoards(true).catch((error: unknown) => {
      console.error('[surveyActions] Failed to load boards for trigger reference data', error);
      throw new Error('Unable to load boards.');
    }),
    getTicketStatuses().catch((error: unknown) => {
      console.error('[surveyActions] Failed to load statuses for trigger reference data', error);
      throw new Error('Unable to load statuses.');
    }),
    getAllPriorities('ticket').catch((error: unknown) => {
      console.error('[surveyActions] Failed to load priorities for trigger reference data', error);
      throw new Error('Unable to load priorities.');
    }),
  ]);

  return {
    boards,
    statuses,
    priorities,
  };
}

function buildTemplateInsertPayload(
  trx: Knex | Knex.Transaction,
  tenantId: string,
  data: z.output<typeof baseTemplateSchema>
): Record<string, unknown> {
  return {
    tenant: tenantId,
    template_name: data.templateName,
    is_default: data.isDefault ?? false,
    rating_type: data.ratingType,
    rating_scale: data.ratingScale,
    rating_labels: data.ratingLabels ?? {},
    prompt_text: data.promptText,
    comment_prompt: data.commentPrompt,
    thank_you_text: data.thankYouText,
    enabled: data.enabled ?? true,
    created_at: trx.fn.now(),
    updated_at: trx.fn.now(),
  };
}

function buildTemplateUpdatePayload(
  trx: Knex | Knex.Transaction,
  data: z.output<typeof updateTemplateSchema>
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    updated_at: trx.fn.now(),
  };

  if (typeof data.templateName === 'string') {
    payload.template_name = data.templateName;
  }
  if (typeof data.isDefault === 'boolean') {
    payload.is_default = data.isDefault;
  }
  if (data.ratingType) {
    payload.rating_type = data.ratingType;
  }
  if (typeof data.ratingScale === 'number') {
    payload.rating_scale = data.ratingScale;
  }
  if (data.ratingLabels) {
    payload.rating_labels = data.ratingLabels;
  }
  if (typeof data.promptText === 'string') {
    payload.prompt_text = data.promptText;
  }
  if (typeof data.commentPrompt === 'string') {
    payload.comment_prompt = data.commentPrompt;
  }
  if (typeof data.thankYouText === 'string') {
    payload.thank_you_text = data.thankYouText;
  }
  if (typeof data.enabled === 'boolean') {
    payload.enabled = data.enabled;
  }

  return payload;
}

async function assertTemplateBelongsToTenant(
  knex: Knex | Knex.Transaction,
  tenantId: string,
  templateId: string
): Promise<void> {
  const exists = await knex<TemplateRow>(SURVEY_TEMPLATE_TABLE)
    .where({ tenant: tenantId, template_id: templateId })
    .first();

  if (!exists) {
    throw new Error('Template does not belong to current tenant');
  }
}
