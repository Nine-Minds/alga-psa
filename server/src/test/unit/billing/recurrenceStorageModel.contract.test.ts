import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  AUTHORITATIVE_RECURRENCE_STORAGE_MODEL,
  normalizeLiveRecurringStorage,
  normalizePresetRecurringStorage,
  normalizeTemplateRecurringStorage,
} from '@shared/billingClients/recurrenceStorageModel';

const repoRoot = path.resolve(import.meta.dirname, '../../../../..');

type CadenceOwnerRow = {
  cadence_owner?: 'client' | 'contract' | null;
};

function createTemplateMigrationKnex(rows: CadenceOwnerRow[], hasCadenceOwnerColumn = false) {
  const state = {
    rows: rows.map((row) => ({ ...row })),
    addedCadenceOwnerColumn: false,
    rawCalls: [] as string[],
  };

  const knex = ((table: string) => {
    if (table !== 'contract_template_lines') {
      throw new Error(`Unexpected table access in template migration test: ${table}`);
    }

    return {
      whereNull(column: string) {
        return {
          async update(payload: Record<string, unknown>) {
            let updates = 0;
            for (const row of state.rows) {
              if ((row as Record<string, unknown>)[column] == null) {
                Object.assign(row, payload);
                updates += 1;
              }
            }
            return updates;
          },
        };
      },
    };
  }) as any;

  knex.schema = {
    hasTable: vi.fn(async (table: string) => table === 'contract_template_lines'),
    hasColumn: vi.fn(async (table: string, column: string) =>
      table === 'contract_template_lines' && column === 'cadence_owner' ? hasCadenceOwnerColumn : false,
    ),
    alterTable: vi.fn(async (_table: string, callback: (table: any) => void) => {
      const tableApi = {
        string: vi.fn(() => ({
          notNullable: vi.fn(() => ({
            defaultTo: vi.fn(() => {
              state.addedCadenceOwnerColumn = true;
            }),
          })),
        })),
        dropColumn: vi.fn(),
      };
      callback(tableApi);
    }),
  };

  knex.raw = vi.fn(async (sql: string) => {
    state.rawCalls.push(sql);
  });

  return { knex, state };
}

function createPresetMigrationKnex(rows: CadenceOwnerRow[], hasCadenceOwnerColumn = false) {
  const state = {
    rows: rows.map((row) => ({ ...row })),
    addedCadenceOwnerColumn: false,
    rawCalls: [] as string[],
    alteredToNotNull: false,
  };

  const knex = ((table: string) => {
    if (table !== 'contract_line_presets') {
      throw new Error(`Unexpected table access in preset migration test: ${table}`);
    }

    return {
      whereNull(column: string) {
        return {
          async update(payload: Record<string, unknown>) {
            let updates = 0;
            for (const row of state.rows) {
              if ((row as Record<string, unknown>)[column] == null) {
                Object.assign(row, payload);
                updates += 1;
              }
            }
            return updates;
          },
        };
      },
    };
  }) as any;

  knex.schema = {
    hasColumn: vi.fn(async (table: string, column: string) =>
      table === 'contract_line_presets' && column === 'cadence_owner' ? hasCadenceOwnerColumn : false,
    ),
    alterTable: vi.fn(async (_table: string, callback: (table: any) => void) => {
      const tableApi = {
        string: vi.fn(() => ({
          nullable: vi.fn(() => {
            state.addedCadenceOwnerColumn = true;
          }),
          notNullable: vi.fn(() => ({
            defaultTo: vi.fn(() => ({
              alter: vi.fn(() => {
                state.alteredToNotNull = true;
              }),
            })),
          })),
        })),
        dropColumn: vi.fn(),
      };
      callback(tableApi);
    }),
  };

  knex.raw = vi.fn(async (sql: string) => {
    state.rawCalls.push(sql);
  });

  return { knex, state };
}

describe('recurrence storage model contracts', () => {
  it('T241: the recurrence-storage model stays internally consistent across live lines, template lines, presets, and shared readers', () => {
    expect(AUTHORITATIVE_RECURRENCE_STORAGE_MODEL.liveContractLines.table).toBe('contract_lines');
    expect(AUTHORITATIVE_RECURRENCE_STORAGE_MODEL.templateLines.table).toBe('contract_template_lines');
    expect(AUTHORITATIVE_RECURRENCE_STORAGE_MODEL.presetDefaults.table).toBe('contract_line_presets');
    expect(AUTHORITATIVE_RECURRENCE_STORAGE_MODEL.templateLines.compatibilityFallbacks).toContain(
      'contract_template_line_terms.billing_timing',
    );
    expect(AUTHORITATIVE_RECURRENCE_STORAGE_MODEL.sharedInterfaces.authoritativeShapes).toEqual(
      expect.arrayContaining(['IContractLine', 'IContractTemplateLine', 'IContractLinePreset']),
    );

    expect(normalizeLiveRecurringStorage({})).toMatchObject({
      billing_timing: 'arrears',
      cadence_owner: 'client',
    });
    expect(
      normalizeTemplateRecurringStorage({
        billing_timing: null,
        terms_billing_timing: 'advance',
      }),
    ).toMatchObject({
      billing_timing: 'advance',
      cadence_owner: 'client',
    });
    expect(
      normalizeTemplateRecurringStorage({
        billing_timing: 'arrears',
        terms_billing_timing: 'advance',
        cadence_owner: 'contract',
      }),
    ).toMatchObject({
      billing_timing: 'arrears',
      cadence_owner: 'contract',
    });
    expect(
      normalizePresetRecurringStorage({
        billing_timing: 'advance',
      }),
    ).toMatchObject({
      billing_timing: 'advance',
      cadence_owner: 'client',
    });

    const packageTemplateModel = fs.readFileSync(
      path.join(repoRoot, 'packages/billing/src/models/contractTemplate.ts'),
      'utf8',
    );
    const packagePresetModel = fs.readFileSync(
      path.join(repoRoot, 'packages/billing/src/models/contractLinePreset.ts'),
      'utf8',
    );
    const packageRepository = fs.readFileSync(
      path.join(repoRoot, 'packages/billing/src/repositories/contractLineRepository.ts'),
      'utf8',
    );
    const serverRepository = fs.readFileSync(
      path.join(repoRoot, 'server/src/lib/repositories/contractLineRepository.ts'),
      'utf8',
    );
    const sharedReader = fs.readFileSync(
      path.join(repoRoot, 'shared/billingClients/contractLines.ts'),
      'utf8',
    );

    expect(packageTemplateModel).toContain('normalizeTemplateRecurringStorage');
    expect(packagePresetModel).toContain('normalizePresetRecurringStorage');
    expect(packageRepository).toContain('normalizeTemplateRecurringStorage');
    expect(packageRepository).toContain('normalizeLiveRecurringStorage');
    expect(serverRepository).toContain('normalizeTemplateRecurringStorage');
    expect(serverRepository).toContain('normalizeLiveRecurringStorage');
    expect(sharedReader).toContain('normalizeLiveRecurringStorage');
  });

  it('T244: billing_timing defaults stay standardized across wizard, custom-line, preset, template, and repository write paths', () => {
    const recurringAuthoringPolicy = fs.readFileSync(
      path.join(repoRoot, 'shared/billingClients/recurringAuthoringPolicy.ts'),
      'utf8',
    );
    const contractWizardActions = fs.readFileSync(
      path.join(repoRoot, 'packages/billing/src/actions/contractWizardActions.ts'),
      'utf8',
    );
    const contractLinePresetActions = fs.readFileSync(
      path.join(repoRoot, 'packages/billing/src/actions/contractLinePresetActions.ts'),
      'utf8',
    );
    const contractLineAction = fs.readFileSync(
      path.join(repoRoot, 'packages/billing/src/actions/contractLineAction.ts'),
      'utf8',
    );
    const packageRepository = fs.readFileSync(
      path.join(repoRoot, 'packages/billing/src/repositories/contractLineRepository.ts'),
      'utf8',
    );
    const serverRepository = fs.readFileSync(
      path.join(repoRoot, 'server/src/lib/repositories/contractLineRepository.ts'),
      'utf8',
    );
    const contractLineService = fs.readFileSync(
      path.join(repoRoot, 'server/src/lib/api/services/ContractLineService.ts'),
      'utf8',
    );

    expect(recurringAuthoringPolicy).toContain(
      "export const DEFAULT_RECURRING_AUTHORING_BILLING_TIMING: RecurringBillingTiming = 'arrears';",
    );
    expect(contractWizardActions).toContain('resolveRecurringAuthoringPolicy({');
    expect(contractLinePresetActions).toContain('resolveRecurringAuthoringPolicy({');
    expect(contractLineAction).toContain('resolveRecurringAuthoringPolicy({');
    expect(contractLineAction).toContain('normalizeTemplateRecurringStorage');
    expect(contractLineAction).toContain('normalizeLiveRecurringStorage');
    expect(packageRepository).toContain('normalizeTemplateRecurringStorage({');
    expect(packageRepository).toContain('normalizeLiveRecurringStorage(baseLine)');
    expect(serverRepository).toContain('normalizeTemplateRecurringStorage({');
    expect(serverRepository).toContain('normalizeLiveRecurringStorage(baseLine)');
    expect(contractLineService).toContain('normalizeTemplateRecurringStorage({');
  });

  it('T242: template-line cadence_owner schema and backfill behavior stay correct for v1 template recurrence storage', async () => {
    const migrationPath = path.join(
      repoRoot,
      'server/migrations/20260317213000_add_cadence_owner_to_contract_template_lines.cjs',
    );
    const migrationSource = fs.readFileSync(migrationPath, 'utf8');
    const migrationModule = await import(pathToFileURL(migrationPath).href);
    const { knex, state } = createTemplateMigrationKnex([
      { cadence_owner: null },
      { cadence_owner: 'client' },
      { cadence_owner: 'contract' },
    ]);

    await migrationModule.up(knex);

    expect(migrationSource).toContain("table.string('cadence_owner', 16).notNullable().defaultTo('client')");
    expect(migrationSource).toContain("CHECK (cadence_owner IN ('client', 'contract'))");
    expect(state.addedCadenceOwnerColumn).toBe(true);
    expect(state.rows.map((row) => row.cadence_owner)).toEqual(['client', 'client', 'contract']);
    expect(state.rawCalls.some((sql) => sql.includes('contract_template_lines_cadence_owner_check'))).toBe(true);
  });

  it('T243: preset-backed cadence_owner defaults survive migration backfill and remain create-time propagation defaults', async () => {
    const migrationPath = path.join(
      repoRoot,
      'server/migrations/20260317193000_add_cadence_owner_to_contract_line_presets.cjs',
    );
    const migrationSource = fs.readFileSync(migrationPath, 'utf8');
    const migrationModule = await import(pathToFileURL(migrationPath).href);
    const { knex, state } = createPresetMigrationKnex([
      { cadence_owner: null },
      { cadence_owner: 'client' },
      { cadence_owner: 'contract' },
    ]);

    await migrationModule.up(knex);

    expect(migrationSource).toContain("table.string('cadence_owner', 20).nullable()");
    expect(migrationSource).toContain("CHECK (cadence_owner IN ('client', 'contract'))");
    expect(state.addedCadenceOwnerColumn).toBe(true);
    expect(state.alteredToNotNull).toBe(true);
    expect(state.rows.map((row) => row.cadence_owner)).toEqual(['client', 'client', 'contract']);
    expect(state.rawCalls.some((sql) => sql.includes('contract_line_presets_cadence_owner_check'))).toBe(true);
  });
});
