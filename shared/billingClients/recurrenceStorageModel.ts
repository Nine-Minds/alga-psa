import type { CadenceOwner } from '@alga-psa/types';

import { DEFAULT_RECURRING_AUTHORING_BILLING_TIMING } from './recurringAuthoringPolicy';
import { resolveCadenceOwner } from './recurringTiming';
import { contractLineOwnStream } from './contractLineTimingRule';

export type RecurringBillingTiming = 'arrears' | 'advance';

type NormalizableRecurringStorage = {
  billing_timing?: RecurringBillingTiming | null;
  cadence_owner?: CadenceOwner | null;
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

export function normalizeTemplateRecurringStorage<T extends NormalizableRecurringStorage>(
  row: T,
): T & { billing_timing: RecurringBillingTiming; cadence_owner: CadenceOwner } {
  return {
    ...row,
    billing_timing:
      row.billing_timing
      ?? DEFAULT_RECURRING_AUTHORING_BILLING_TIMING,
    cadence_owner: resolveCadenceOwner(row.cadence_owner),
  };
}

export function normalizePresetRecurringStorage<T extends NormalizableRecurringStorage>(
  row: T,
): T & { billing_timing: RecurringBillingTiming; cadence_owner: CadenceOwner } {
  return normalizeLiveRecurringStorage(row);
}

/**
 * Copy-path normalizer: a row copied from a template, preset or another plan may
 * carry a stored advance timing that its line type cannot honour (legacy data).
 * Copy sites use this so the copy never re-creates a bad row.
 */
export function normalizeRecurringStorageForLineType<T extends NormalizableRecurringStorage>(
  row: T,
  lineType: string | null | undefined,
): T & { billing_timing: RecurringBillingTiming; cadence_owner: CadenceOwner } {
  const normalized = normalizeLiveRecurringStorage(row);
  return {
    ...normalized,
    // The line's own stream owns the family/timing mapping for a line type.
    billing_timing: contractLineOwnStream({
      contract_line_type: lineType,
      billing_timing: normalized.billing_timing,
    }).duePosition,
  };
}
