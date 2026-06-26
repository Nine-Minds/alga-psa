'use server'

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import {
  inboundEmailRuleInputSchema,
  inboundEmailRuleTestSampleSchema,
  type InboundEmailRuleInput,
  type InboundEmailRuleTestSample,
} from '@alga-psa/shared/services/email/inboundEmailRules/validation';
import { evaluateInboundEmailRules } from '@alga-psa/shared/services/email/inboundEmailRules/engine';
import type {
  InboundEmailRule,
  InboundEmailRuleCondition,
  InboundEmailRuleEvaluation,
} from '@alga-psa/shared/services/email/inboundEmailRules/types';

export interface InboundEmailRuleRecord {
  id: string;
  name: string;
  is_active: boolean;
  position: number;
  provider_ids: string[] | null;
  conditions: InboundEmailRule['conditions'];
  action_type: InboundEmailRule['action_type'];
  action_config: Record<string, unknown>;
  on_no_match: InboundEmailRule['on_no_match'];
  fallback_inbound_ticket_defaults_id: string | null;
  created_at?: string;
  updated_at?: string;
}

const RULE_COLUMNS = [
  'id',
  'name',
  'is_active',
  'position',
  'provider_ids',
  'conditions',
  'action_type',
  'action_config',
  'on_no_match',
  'fallback_inbound_ticket_defaults_id',
  'created_at',
  'updated_at',
] as const;

async function assertEmailSettingsPermission(
  user: unknown,
  action: 'read' | 'create' | 'update' | 'delete'
): Promise<void> {
  const permitted = await hasPermission(user as any, 'system_settings', action);
  if (!permitted) {
    throw new Error('Permission denied: Cannot manage inbound email rules');
  }
}

function parseRuleInput(data: unknown): InboundEmailRuleInput {
  const result = inboundEmailRuleInputSchema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path?.length ? ` (${issue.path.join('.')})` : '';
    throw new Error(`Invalid rule: ${issue?.message ?? 'validation failed'}${path}`);
  }
  return result.data;
}

async function assertReferencedDefaultsExist(
  trx: Knex.Transaction,
  tenant: string,
  rule: InboundEmailRuleInput
): Promise<void> {
  const referencedIds = new Set<string>();
  if (rule.fallback_inbound_ticket_defaults_id) {
    referencedIds.add(rule.fallback_inbound_ticket_defaults_id);
  }
  if (rule.action_type === 'set_destination') {
    const destinationId = (rule.action_config as { inbound_ticket_defaults_id?: unknown })
      .inbound_ticket_defaults_id;
    if (typeof destinationId === 'string' && destinationId) {
      referencedIds.add(destinationId);
    }
  }
  if (!referencedIds.size) return;

  const rows = await tenantDb(trx, tenant).table('inbound_ticket_defaults')
    .select('id')
    .where({ is_active: true })
    .whereIn('id', Array.from(referencedIds));
  const found = new Set(rows.map((row: { id: string }) => row.id));
  for (const id of referencedIds) {
    if (!found.has(id)) {
      throw new Error('Referenced ticket defaults set does not exist or is inactive');
    }
  }
}

export const getInboundEmailRules = withAuth(async (
  user,
  { tenant }
): Promise<{ rules: InboundEmailRuleRecord[] }> => {
  await assertEmailSettingsPermission(user, 'read');
  const { knex } = await createTenantKnex();

  const rules = await knex('inbound_email_rules')
    .where({ tenant })
    .orderBy('position', 'asc')
    .orderBy('id', 'asc')
    .select(...RULE_COLUMNS);

  return { rules };
});

export const createInboundEmailRule = withAuth(async (
  user,
  { tenant },
  data: unknown
): Promise<{ rule: InboundEmailRuleRecord }> => {
  await assertEmailSettingsPermission(user, 'create');
  const input = parseRuleInput(data);
  const { knex } = await createTenantKnex();

  const rule = await withTransaction(knex, async (trx: Knex.Transaction) => {
    await assertReferencedDefaultsExist(trx, tenant, input);

    const maxRow = await trx('inbound_email_rules')
      .where({ tenant })
      .max('position as max')
      .first();
    const nextPosition = (Number((maxRow as any)?.max) || 0) + 1;

    const [row] = await trx('inbound_email_rules')
      .insert({
        tenant,
        name: input.name,
        is_active: input.is_active,
        position: nextPosition,
        provider_ids: input.provider_ids ? JSON.stringify(input.provider_ids) : null,
        conditions: JSON.stringify(input.conditions),
        action_type: input.action_type,
        action_config: JSON.stringify(input.action_config),
        on_no_match: input.on_no_match,
        fallback_inbound_ticket_defaults_id: input.fallback_inbound_ticket_defaults_id,
      })
      .returning([...RULE_COLUMNS]);
    return row;
  });

  return { rule };
});

export const updateInboundEmailRule = withAuth(async (
  user,
  { tenant },
  id: string,
  data: unknown
): Promise<{ rule: InboundEmailRuleRecord }> => {
  await assertEmailSettingsPermission(user, 'update');
  const input = parseRuleInput(data);
  const { knex } = await createTenantKnex();

  const rule = await withTransaction(knex, async (trx: Knex.Transaction) => {
    await assertReferencedDefaultsExist(trx, tenant, input);

    const [row] = await trx('inbound_email_rules')
      .where({ tenant, id })
      .update({
        name: input.name,
        is_active: input.is_active,
        provider_ids: input.provider_ids ? JSON.stringify(input.provider_ids) : null,
        conditions: JSON.stringify(input.conditions),
        action_type: input.action_type,
        action_config: JSON.stringify(input.action_config),
        on_no_match: input.on_no_match,
        fallback_inbound_ticket_defaults_id: input.fallback_inbound_ticket_defaults_id,
        updated_at: trx.fn.now(),
      })
      .returning([...RULE_COLUMNS]);

    if (!row) {
      throw new Error('Inbound email rule not found');
    }
    return row;
  });

  return { rule };
});

export const setInboundEmailRuleActive = withAuth(async (
  user,
  { tenant },
  id: string,
  isActive: boolean
): Promise<{ rule: InboundEmailRuleRecord }> => {
  await assertEmailSettingsPermission(user, 'update');
  const { knex } = await createTenantKnex();

  const [rule] = await knex('inbound_email_rules')
    .where({ tenant, id })
    .update({ is_active: isActive, updated_at: knex.fn.now() })
    .returning([...RULE_COLUMNS]);

  if (!rule) {
    throw new Error('Inbound email rule not found');
  }
  return { rule };
});

export const deleteInboundEmailRule = withAuth(async (
  user,
  { tenant },
  id: string
): Promise<{ success: true }> => {
  await assertEmailSettingsPermission(user, 'delete');
  const { knex } = await createTenantKnex();

  const deleted = await knex('inbound_email_rules').where({ tenant, id }).delete();
  if (!deleted) {
    throw new Error('Inbound email rule not found');
  }
  return { success: true };
});

export const reorderInboundEmailRules = withAuth(async (
  user,
  { tenant },
  orderedIds: string[]
): Promise<{ rules: InboundEmailRuleRecord[] }> => {
  await assertEmailSettingsPermission(user, 'update');
  if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== 'string')) {
    throw new Error('Invalid rule ordering payload');
  }
  const { knex } = await createTenantKnex();

  const rules = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const existing = await trx('inbound_email_rules').where({ tenant }).select('id');
    const existingIds = new Set(existing.map((row: { id: string }) => row.id));
    if (existingIds.size !== orderedIds.length || orderedIds.some((id) => !existingIds.has(id))) {
      throw new Error('Rule ordering payload does not match the current rule set');
    }

    for (let index = 0; index < orderedIds.length; index += 1) {
      await trx('inbound_email_rules')
        .where({ tenant, id: orderedIds[index] })
        .update({ position: index + 1, updated_at: trx.fn.now() });
    }

    return trx('inbound_email_rules')
      .where({ tenant })
      .orderBy('position', 'asc')
      .select(...RULE_COLUMNS);
  });

  return { rules };
});

/**
 * AI rule availability for the editor: the action type is always shown, but
 * only enabled when running EE with the AI Assistant add-on active.
 */
export const getInboundEmailRuleAiAvailability = withAuth(async (
  user,
  { tenant }
): Promise<{ enterprise: boolean; aiAddonActive: boolean }> => {
  await assertEmailSettingsPermission(user, 'read');

  const { isEnterprise } = await import('@alga-psa/core/features');
  if (!isEnterprise) {
    return { enterprise: false, aiAddonActive: false };
  }

  try {
    const { ADD_ONS, tenantHasAddOn } = await import('@alga-psa/types');
    const { knex } = await createTenantKnex();
    const rows = await tenantDb(knex, tenant)
      .table<{ addon_key: string; expires_at: string | Date | null }>('tenant_addons')
      .select('addon_key', 'expires_at');

    const now = Date.now();
    const knownAddOns = new Set<string>(Object.values(ADD_ONS));
    const active = rows
      .filter((row) => !row.expires_at || new Date(row.expires_at).getTime() > now)
      .map((row) => row.addon_key)
      .filter((value): value is Parameters<typeof tenantHasAddOn>[1] => knownAddOns.has(value));

    return { enterprise: true, aiAddonActive: tenantHasAddOn(active as any, ADD_ONS.AI_ASSISTANT) };
  } catch {
    return { enterprise: true, aiAddonActive: false };
  }
});

/**
 * Tester quick-add: when extraction succeeds but no client resolves, let the
 * admin register the extracted value as an alias without leaving the editor.
 */
export const addClientNameAliasFromRuleTester = withAuth(async (
  user,
  { tenant },
  clientId: string,
  rawAlias: string
): Promise<{ success: true }> => {
  await assertEmailSettingsPermission(user, 'update');

  const alias = String(rawAlias ?? '').replace(/\s+/g, ' ').trim();
  if (!alias) {
    throw new Error('Alias is required');
  }
  if (alias.length > 255) {
    throw new Error('Alias is too long');
  }
  if (typeof clientId !== 'string' || !clientId) {
    throw new Error('Client is required');
  }

  const { knex } = await createTenantKnex();
  await withTransaction(knex, async (trx: Knex.Transaction) => {
    const client = await tenantDb(trx, tenant)
      .table('clients')
      .select('client_id')
      .where({ client_id: clientId })
      .first();
    if (!client) {
      throw new Error('Client not found');
    }

    try {
      await trx('client_name_aliases').insert({
        tenant,
        id: trx.raw('gen_random_uuid()'),
        client_id: clientId,
        alias,
      });
    } catch (e: any) {
      if (String(e?.code ?? '') === '23505') {
        throw new Error(`Alias "${alias}" is already assigned to a client.`);
      }
      throw e;
    }
  });

  return { success: true };
});

/**
 * Run the production rules evaluator against a draft rule and a pasted sample
 * email. Persists nothing; client/alias matching and destination validation
 * hit the real tables so the tester shows exactly what processing would do.
 */
export const testInboundEmailRule = withAuth(async (
  user,
  { tenant },
  data: { rule: unknown; sample: unknown }
): Promise<{ evaluation: InboundEmailRuleEvaluation }> => {
  await assertEmailSettingsPermission(user, 'read');
  const ruleInput = parseRuleInput(data.rule);

  const sampleResult = inboundEmailRuleTestSampleSchema.safeParse(data.sample ?? {});
  if (!sampleResult.success) {
    throw new Error('Invalid sample email');
  }
  const sample: InboundEmailRuleTestSample = sampleResult.data;

  const draftRule: InboundEmailRule = {
    tenant,
    id: 'draft-rule',
    name: ruleInput.name,
    is_active: true,
    position: 1,
    // The tester has no receiving mailbox; provider filtering is not part of
    // what it exercises.
    provider_ids: null,
    // Cast: zod's inferred object type loses required-ness under consumers
    // compiled with strict: false (e.g. ee/server), though the parsed value
    // always has every field.
    conditions: ruleInput.conditions as InboundEmailRuleCondition[],
    action_type: ruleInput.action_type,
    action_config: ruleInput.action_config,
    on_no_match: ruleInput.on_no_match,
    fallback_inbound_ticket_defaults_id: ruleInput.fallback_inbound_ticket_defaults_id,
  };

  const evaluation = await evaluateInboundEmailRules({
    tenantId: tenant,
    providerId: 'rule-tester',
    emailData: {
      id: 'rule-tester-sample',
      from: { email: sample.from },
      to: sample.to ? [{ email: sample.to }] : [],
      subject: sample.subject,
      body: { text: sample.bodyText },
    },
    deps: {
      loadRules: async () => [draftRule],
    },
  });

  return { evaluation };
});
