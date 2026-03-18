import type { CadenceOwner } from '@alga-psa/types';

import { DEFAULT_RECURRING_AUTHORING_BILLING_TIMING } from './recurringAuthoringPolicy';
import { resolveCadenceOwner } from './recurringTiming';

export type RecurringBillingTiming = 'arrears' | 'advance';

type NormalizableRecurringStorage = {
  billing_timing?: RecurringBillingTiming | null;
  cadence_owner?: CadenceOwner | null;
};

type TemplateRecurringStorage = NormalizableRecurringStorage & {
  terms_billing_timing?: RecurringBillingTiming | null;
};

// One storage contract for recurring authoring/read paths:
// - live lines store cadence/timing directly on contract_lines
// - template lines store cadence/timing directly on contract_template_lines
// - presets store cadence/timing directly on contract_line_presets
// - fixed-only partial-period compatibility settings stay on the fixed-config tables for
//   template and preset surfaces until those legacy config tables are retired
export const AUTHORITATIVE_RECURRENCE_STORAGE_MODEL = {
  liveContractLines: {
    table: 'contract_lines',
    fields: ['billing_frequency', 'billing_timing', 'cadence_owner', 'enable_proration', 'billing_cycle_alignment'],
  },
  templateLines: {
    table: 'contract_template_lines',
    fields: ['billing_frequency', 'billing_timing', 'cadence_owner'],
    fixedConfigTable: 'contract_template_line_fixed_config',
    fixedConfigFields: ['enable_proration', 'billing_cycle_alignment'],
    compatibilityFallbacks: ['contract_template_line_terms.billing_timing'],
  },
  presetDefaults: {
    table: 'contract_line_presets',
    fields: ['billing_frequency', 'billing_timing', 'cadence_owner'],
    fixedConfigTable: 'contract_line_preset_fixed_config',
    fixedConfigFields: ['enable_proration', 'billing_cycle_alignment'],
  },
  sharedInterfaces: {
    authoritativeShapes: ['IContractLine', 'IContractTemplateLine', 'IContractLinePreset'],
    compatibilityShapes: [
      'IClientContractLine',
      'IContractLineMapping',
      'IContractLineFixedConfig',
      'IContractLinePresetFixedConfig',
    ],
  },
} as const;

export function normalizeLiveRecurringStorage<T extends NormalizableRecurringStorage>(
  row: T,
): T & { billing_timing: RecurringBillingTiming; cadence_owner: CadenceOwner } {
  return {
    ...row,
    billing_timing: row.billing_timing ?? DEFAULT_RECURRING_AUTHORING_BILLING_TIMING,
    cadence_owner: resolveCadenceOwner(row.cadence_owner),
  };
}

export function normalizeTemplateRecurringStorage<T extends TemplateRecurringStorage>(
  row: T,
): T & { billing_timing: RecurringBillingTiming; cadence_owner: CadenceOwner } {
  return {
    ...row,
    billing_timing:
      row.billing_timing
      ?? row.terms_billing_timing
      ?? DEFAULT_RECURRING_AUTHORING_BILLING_TIMING,
    cadence_owner: resolveCadenceOwner(row.cadence_owner),
  };
}

export function normalizePresetRecurringStorage<T extends NormalizableRecurringStorage>(
  row: T,
): T & { billing_timing: RecurringBillingTiming; cadence_owner: CadenceOwner } {
  return normalizeLiveRecurringStorage(row);
}
