import { tenantDb } from '@alga-psa/db';
import {
  getAdminConnection,
  withAdminTransactionRetryReadOnly,
} from '@alga-psa/db/admin.js';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  runOnboardingSeeds,
  type SeedRunLog,
} from './onboarding-seeds-operations.js';
import { listProductSeedFiles } from './product-bootstrap-resolver.js';

// Seed 03 rebuilds role_permissions and would remove every grant from the AlgaDesk Agent role.
export const PSA_BACKFILL_SEED_EXCLUDES = ['03_role_permissions.cjs'] as const;

const PSA_ROLE_REQUIREMENTS = [
  { roleName: 'Finance', scope: 'msp', msp: true, client: false },
  { roleName: 'Technician', scope: 'msp', msp: true, client: false },
  { roleName: 'Project Manager', scope: 'msp', msp: true, client: false },
  { roleName: 'Dispatcher', scope: 'msp', msp: true, client: false },
  { roleName: 'Finance', scope: 'client', msp: false, client: true },
] as const;

export interface ProductUpgradeTenantInfo {
  tenantId: string;
  clientName: string | null;
  productCode: string | null;
}

export interface ProductUpgradeRoleStatus {
  roleName: string;
  scope: 'msp' | 'client';
  exists: boolean;
}

export interface ProductUpgradeDryRunPlan {
  mode: 'dry-run';
  tenant: ProductUpgradeTenantInfo;
  seedFilesWouldRun: string[];
  roles: ProductUpgradeRoleStatus[];
  activeTaxRateExists: boolean;
  rolePermissionInserts: ProductUpgradeRolePermissionPlan[];
  usersNeedingTechnicianRole: number;
  clientsMissingTaxSettings: number;
  itilBoardsMissingSla: number;
}

export interface ProductUpgradeRolePermissionPlan {
  roleName: string;
  scope: 'msp' | 'client';
  roleExists: boolean;
  rowsWouldInsert: number;
  skippedUnknownKeys: number;
}

export interface ClientTaxBackfillResult {
  clientsChecked: number;
  settingsCreated: number;
  associationsCreated: number;
}

export interface SlaParityResult {
  boardsChecked: number;
  policyCreated: number;
  thresholdsCreated: number;
  targetsCreated: number;
  boardsAssigned: number;
}

export interface ProductUpgradeRunResult {
  mode: 'staged' | 'complete';
  tenant: ProductUpgradeTenantInfo;
  seedsApplied: string[];
  completedSteps: string[];
  flipWithheld: boolean;
}

export type ProductUpgradeResult = ProductUpgradeDryRunPlan | ProductUpgradeRunResult;

export interface RunProductUpgradeOptions {
  dryRun?: boolean;
  flipOnly?: boolean;
  skipStripe?: boolean;
  log: SeedRunLog;
}

interface TenantRow {
  tenant: string;
  client_name: string | null;
  product_code: string | null;
}

interface RoleRow {
  tenant: string;
  role_id: string;
  role_name: string;
  msp: boolean;
  client: boolean;
}

interface PermissionRow {
  tenant: string;
  permission_id: string;
  resource: string;
  action: string;
  msp: boolean;
  client: boolean;
}

type RoleGrant = readonly string[] | string;

interface PsaRoleGrants {
  allMsp: string;
  msp: Record<string, RoleGrant>;
  client: Record<string, RoleGrant>;
}

const ITIL_POLICY_NAME = 'ITIL Standard';
const ITIL_POLICY_DESCRIPTION = 'Industry-standard SLA targets for ITIL priority levels. Auto-created when using ITIL priority mode.';
const ITIL_SLA_TARGETS: Record<number, {
  responseTimeMinutes: number;
  resolutionTimeMinutes: number;
  is24x7: boolean;
}> = {
  1: { responseTimeMinutes: 15, resolutionTimeMinutes: 60, is24x7: true },
  2: { responseTimeMinutes: 30, resolutionTimeMinutes: 240, is24x7: false },
  3: { responseTimeMinutes: 60, resolutionTimeMinutes: 1440, is24x7: false },
  4: { responseTimeMinutes: 240, resolutionTimeMinutes: 4320, is24x7: false },
  5: { responseTimeMinutes: 480, resolutionTimeMinutes: 10080, is24x7: false },
};

const SLA_NOTIFICATION_THRESHOLDS = [
  {
    threshold_percent: 50,
    notification_type: 'warning',
    notify_assignee: true,
    notify_board_manager: false,
    notify_escalation_manager: false,
    channels: ['in_app'],
  },
  {
    threshold_percent: 75,
    notification_type: 'warning',
    notify_assignee: true,
    notify_board_manager: true,
    notify_escalation_manager: false,
    channels: ['in_app'],
  },
  {
    threshold_percent: 90,
    notification_type: 'warning',
    notify_assignee: true,
    notify_board_manager: true,
    notify_escalation_manager: true,
    channels: ['in_app', 'email'],
  },
  {
    threshold_percent: 100,
    notification_type: 'breach',
    notify_assignee: true,
    notify_board_manager: true,
    notify_escalation_manager: true,
    channels: ['in_app', 'email'],
  },
] as const;

function resolveOnboardingSeedsRoot(): string {
  const currentFileUrl = import.meta.url;
  if (currentFileUrl.includes('/dist/')) {
    return path.resolve(process.cwd(), 'dist/seeds/onboarding');
  }

  return path.resolve(
    path.dirname(fileURLToPath(currentFileUrl)),
    '../../../server/seeds/onboarding',
  );
}

async function loadPsaRoleGrants(): Promise<PsaRoleGrants> {
  const grantModulePath = path.join(
    resolveOnboardingSeedsRoot(),
    'lib',
    'roleGrants.cjs',
  );
  const imported = await import(pathToFileURL(grantModulePath).href);
  const grantModule = (imported.default ?? imported) as {
    ALL_MSP: string;
    psa: {
      msp: Record<string, RoleGrant>;
      client: Record<string, RoleGrant>;
    };
  };

  return {
    allMsp: grantModule.ALL_MSP,
    msp: grantModule.psa.msp,
    client: grantModule.psa.client,
  };
}

function isRoleInScope(role: RoleRow, scope: 'msp' | 'client'): boolean {
  return scope === 'msp'
    ? role.msp === true && role.client === false
    : role.msp === false && role.client === true;
}

function permissionKey(permission: PermissionRow): string {
  return `${permission.resource}:${permission.action}:${permission.msp ? 'msp' : 'client'}`;
}

function resolveGrantPermissionIds(
  grant: RoleGrant,
  allMspSentinel: string,
  permissions: PermissionRow[],
): { permissionIds: string[]; skippedUnknownKeys: number } {
  if (grant === allMspSentinel) {
    return {
      permissionIds: permissions
        .filter(permission => permission.msp === true)
        .map(permission => permission.permission_id),
      skippedUnknownKeys: 0,
    };
  }

  const permissionByKey = new Map(
    permissions.map(permission => [permissionKey(permission), permission.permission_id]),
  );
  const permissionIds: string[] = [];
  let skippedUnknownKeys = 0;
  for (const key of grant) {
    const permissionId = permissionByKey.get(key);
    if (permissionId) {
      permissionIds.push(permissionId);
    } else {
      skippedUnknownKeys += 1;
    }
  }

  return { permissionIds: [...new Set(permissionIds)], skippedUnknownKeys };
}

async function listPsaBackfillSeedFiles(): Promise<string[]> {
  return (await listProductSeedFiles({
    onboardingSeedsRoot: resolveOnboardingSeedsRoot(),
    productCode: 'psa',
  })).filter(fileName => !PSA_BACKFILL_SEED_EXCLUDES.includes(
    fileName as (typeof PSA_BACKFILL_SEED_EXCLUDES)[number],
  ));
}

async function getRoleStatuses(tenantId: string): Promise<ProductUpgradeRoleStatus[]> {
  const knex = await getAdminConnection();
  const db = tenantDb(knex, tenantId);
  const [mspRoles, clientRoles] = await Promise.all([
    db.table<RoleRow>('roles')
      .where({ tenant: tenantId, msp: true, client: false })
      .whereIn('role_name', PSA_ROLE_REQUIREMENTS
        .filter(role => role.scope === 'msp')
        .map(role => role.roleName))
      .select('role_name', 'msp', 'client'),
    db.table<RoleRow>('roles')
      .where({ tenant: tenantId, msp: false, client: true })
      .whereIn('role_name', PSA_ROLE_REQUIREMENTS
        .filter(role => role.scope === 'client')
        .map(role => role.roleName))
      .select('role_name', 'msp', 'client'),
  ]);
  const roles = [...mspRoles, ...clientRoles];

  return PSA_ROLE_REQUIREMENTS.map(requirement => ({
    roleName: requirement.roleName,
    scope: requirement.scope,
    exists: roles.some(role =>
      role.role_name === requirement.roleName
      && role.msp === requirement.msp
      && role.client === requirement.client),
  }));
}

async function hasActiveTaxRate(tenantId: string): Promise<boolean> {
  const knex = await getAdminConnection();
  const activeTaxRate = await tenantDb(knex, tenantId)
    .table('tax_rates')
    .where({ tenant: tenantId, is_active: true })
    .first('tax_rate_id');

  return activeTaxRate !== undefined;
}

export async function preflightProductUpgrade(
  tenantId: string,
  log: SeedRunLog,
): Promise<ProductUpgradeTenantInfo> {
  const knex = await getAdminConnection();
  const tenant = await tenantDb(knex, tenantId)
    .table<TenantRow>('tenants')
    .where({ tenant: tenantId })
    .first('tenant', 'client_name', 'product_code') as TenantRow | undefined;

  if (!tenant) {
    throw new Error(`Cannot upgrade tenant ${tenantId}: tenant row does not exist`);
  }
  if (tenant.product_code !== 'algadesk') {
    throw new Error(
      `Cannot upgrade tenant ${tenantId}: expected product_code "algadesk", found "${tenant.product_code ?? 'null'}"`,
    );
  }

  const tenantInfo: ProductUpgradeTenantInfo = {
    tenantId: tenant.tenant,
    clientName: tenant.client_name,
    productCode: tenant.product_code,
  };
  log.info('Product upgrade preflight passed', { tenant: tenantInfo });
  return tenantInfo;
}

export async function backfillPsaSeeds(
  tenantId: string,
  log: SeedRunLog,
): Promise<string[]> {
  log.info('Starting PSA seed backfill', {
    tenantId,
    excludedSeedFiles: PSA_BACKFILL_SEED_EXCLUDES,
  });
  const result = await runOnboardingSeeds(tenantId, 'psa', {
    include: fileName => !PSA_BACKFILL_SEED_EXCLUDES.includes(
      fileName as (typeof PSA_BACKFILL_SEED_EXCLUDES)[number],
    ),
    log,
  });
  return result.seedsApplied;
}

export async function applyRbacDelta(
  tenantId: string,
  log: SeedRunLog,
): Promise<void> {
  const grants = await loadPsaRoleGrants();

  await withAdminTransactionRetryReadOnly(async trx => {
    const db = tenantDb(trx, tenantId);
    const [roles, permissions] = await Promise.all([
      db.table<RoleRow>('roles')
        .where({ tenant: tenantId })
        .select('tenant', 'role_id', 'role_name', 'msp', 'client'),
      db.table<PermissionRow>('permissions')
        .where({ tenant: tenantId })
        .select('tenant', 'permission_id', 'resource', 'action', 'msp', 'client'),
    ]);

    for (const scope of ['msp', 'client'] as const) {
      for (const [roleName, grant] of Object.entries(grants[scope])) {
        const matchingRoles = roles.filter(role =>
          role.role_name === roleName && isRoleInScope(role, scope));

        for (const role of matchingRoles) {
          const { permissionIds, skippedUnknownKeys } = resolveGrantPermissionIds(
            grant,
            grants.allMsp,
            permissions,
          );
          const beforeRows = await db.table('role_permissions')
            .where({ tenant: tenantId, role_id: role.role_id })
            .select('permission_id');

          if (permissionIds.length > 0) {
            await db.table('role_permissions')
              .insert(permissionIds.map(permissionId => ({
                tenant: tenantId,
                role_id: role.role_id,
                permission_id: permissionId,
              })))
              .onConflict(['tenant', 'role_id', 'permission_id'])
              .ignore();
          }

          const afterRows = await db.table('role_permissions')
            .where({ tenant: tenantId, role_id: role.role_id })
            .select('permission_id');
          log.info('Applied additive PSA role grants', {
            tenantId,
            roleName,
            scope,
            roleId: role.role_id,
            inserted: afterRows.length - beforeRows.length,
            skippedUnknownKeys,
          });
        }
      }
    }

    const technicianRole = roles.find(role =>
      role.role_name === 'Technician' && isRoleInScope(role, 'msp'));
    if (!technicianRole) {
      throw new Error(`Cannot apply RBAC delta for tenant ${tenantId}: MSP Technician role is missing`);
    }

    const agentRole = roles.find(role =>
      role.role_name === 'Agent' && isRoleInScope(role, 'msp'));
    if (!agentRole) {
      log.info('MSP Agent role is absent; skipping Agent-to-Technician dual-role assignment', {
        tenantId,
      });
      return;
    }

    const agentAssignments = await db.table('user_roles')
      .where({ tenant: tenantId, role_id: agentRole.role_id })
      .select('user_id');
    const agentUserIds = [...new Set(agentAssignments.map(row => row.user_id as string))];
    const beforeAssignments = agentUserIds.length === 0
      ? []
      : await db.table('user_roles')
        .where({ tenant: tenantId, role_id: technicianRole.role_id })
        .whereIn('user_id', agentUserIds)
        .select('user_id');

    if (agentUserIds.length > 0) {
      await db.table('user_roles')
        .insert(agentUserIds.map(userId => ({
          tenant: tenantId,
          user_id: userId,
          role_id: technicianRole.role_id,
        })))
        .onConflict(['tenant', 'user_id', 'role_id'])
        .ignore();
    }

    const afterAssignments = agentUserIds.length === 0
      ? []
      : await db.table('user_roles')
        .where({ tenant: tenantId, role_id: technicianRole.role_id })
        .whereIn('user_id', agentUserIds)
        .select('user_id');
    log.info('Applied Agent-to-Technician dual-role assignments', {
      tenantId,
      agentUsersChecked: agentUserIds.length,
      inserted: afterAssignments.length - beforeAssignments.length,
    });
  });
}

export async function backfillClientTaxDefaults(
  tenantId: string,
  log: SeedRunLog,
): Promise<ClientTaxBackfillResult> {
  const result = await withAdminTransactionRetryReadOnly(async trx => {
    const db = tenantDb(trx, tenantId);
    const rate = await db.table('tax_rates')
      .where({ tenant: tenantId, is_active: true })
      .orderBy('created_at', 'asc')
      .first();
    if (!rate) {
      throw new Error(
        `Cannot backfill client tax defaults for tenant ${tenantId}: no active tax rate exists after PSA seed backfill`,
      );
    }

    const clients = await db.table('clients')
      .where({ tenant: tenantId })
      .select('client_id');
    let settingsCreated = 0;
    let associationsCreated = 0;

    // Keep client tax reads single-table because these tables may be Citus-local.
    for (const client of clients) {
      const insertedSettings = await db.table('client_tax_settings')
        .insert({
          tenant: tenantId,
          client_id: client.client_id,
          is_reverse_charge_applicable: false,
        })
        .onConflict(['tenant', 'client_id'])
        .ignore()
        .returning('client_id');
      settingsCreated += insertedSettings.length;

      const existingAssociation = await db.table('client_tax_rates')
        .where({ tenant: tenantId, client_id: client.client_id })
        .whereNull('location_id')
        .first('client_tax_rates_id');
      if (!existingAssociation) {
        await db.table('client_tax_rates').insert({
          tenant: tenantId,
          client_id: client.client_id,
          tax_rate_id: rate.tax_rate_id,
          is_default: true,
          location_id: null,
        });
        associationsCreated += 1;
      }
    }

    const existingDefaultComponent = await db.table('tax_components')
      .where({
        tenant: tenantId,
        tax_rate_id: rate.tax_rate_id,
        name: 'Default Tax',
      })
      .first('tax_component_id');
    if (!existingDefaultComponent) {
      await db.table('tax_components').insert({
        tenant: tenantId,
        tax_component_id: randomUUID(),
        tax_rate_id: rate.tax_rate_id,
        name: 'Default Tax',
        rate: Math.ceil(Number(rate.tax_percentage)),
        sequence: 1,
        is_compound: false,
      });
    }

    return {
      clientsChecked: clients.length,
      settingsCreated,
      associationsCreated,
    };
  });

  log.info('Client tax defaults backfill completed', { tenantId, ...result });
  return result;
}

export async function ensureSlaParity(
  tenantId: string,
  log: SeedRunLog,
): Promise<SlaParityResult> {
  const result = await withAdminTransactionRetryReadOnly(async trx => {
    const db = tenantDb(trx, tenantId);
    const boards = await db.table('boards')
      .where({ tenant: tenantId, priority_type: 'itil' })
      .select('board_id', 'sla_policy_id');
    if (boards.length === 0) {
      return {
        boardsChecked: 0,
        policyCreated: 0,
        thresholdsCreated: 0,
        targetsCreated: 0,
        boardsAssigned: 0,
      };
    }

    let policy = await db.table('sla_policies')
      .where({ tenant: tenantId, policy_name: ITIL_POLICY_NAME })
      .first('sla_policy_id');
    let policyCreated = 0;
    if (!policy) {
      const slaPolicyId = randomUUID();
      await db.table('sla_policies').insert({
        tenant: tenantId,
        sla_policy_id: slaPolicyId,
        policy_name: ITIL_POLICY_NAME,
        description: ITIL_POLICY_DESCRIPTION,
        is_default: false,
        business_hours_schedule_id: null,
      });
      policy = { sla_policy_id: slaPolicyId };
      policyCreated = 1;
    }

    const thresholdRows = SLA_NOTIFICATION_THRESHOLDS.map(threshold => ({
      tenant: tenantId,
      threshold_id: randomUUID(),
      sla_policy_id: policy.sla_policy_id,
      ...threshold,
      channels: [...threshold.channels],
    }));
    const insertedThresholds = await db.table('sla_notification_thresholds')
      .insert(thresholdRows)
      .onConflict(['tenant', 'sla_policy_id', 'threshold_percent'])
      .ignore()
      .returning('threshold_id');

    const priorities = await db.table('priorities')
      .where({
        tenant: tenantId,
        is_from_itil_standard: true,
        item_type: 'ticket',
      })
      .select('priority_id', 'itil_priority_level');
    const targetRows: Array<Record<string, unknown>> = [];
    for (const priority of priorities) {
      const level = Number(priority.itil_priority_level);
      const target = ITIL_SLA_TARGETS[level];
      if (!target) {
        log.info('Warning: skipping ITIL SLA target for priority with missing or unmapped level', {
          tenantId,
          priorityId: priority.priority_id,
          itilPriorityLevel: priority.itil_priority_level ?? null,
        });
        continue;
      }
      targetRows.push({
        tenant: tenantId,
        target_id: randomUUID(),
        sla_policy_id: policy.sla_policy_id,
        priority_id: priority.priority_id,
        response_time_minutes: target.responseTimeMinutes,
        resolution_time_minutes: target.resolutionTimeMinutes,
        escalation_1_percent: 70,
        escalation_2_percent: 90,
        escalation_3_percent: 110,
        is_24x7: target.is24x7,
      });
    }

    const insertedTargets = targetRows.length === 0
      ? []
      : await db.table('sla_policy_targets')
        .insert(targetRows)
        .onConflict(['tenant', 'sla_policy_id', 'priority_id'])
        .ignore()
        .returning('target_id');
    const boardsAssigned = await db.table('boards')
      .where({ tenant: tenantId, priority_type: 'itil' })
      .whereNull('sla_policy_id')
      .update({ sla_policy_id: policy.sla_policy_id });

    return {
      boardsChecked: boards.length,
      policyCreated,
      thresholdsCreated: insertedThresholds.length,
      targetsCreated: insertedTargets.length,
      boardsAssigned,
    };
  });

  if (result.boardsChecked === 0) {
    log.info('No ITIL-priority boards found; SLA parity ensure skipped', { tenantId });
  } else {
    log.info('SLA parity ensure completed', { tenantId, ...result });
  }
  return result;
}

export async function swapStripeProduct(
  tenantId: string,
  log: SeedRunLog,
): Promise<void> {
  const message = 'Stripe product swap is not implemented; refusing to continue to the product-code flip';
  log.error(message, { tenantId });
  throw new Error(message);
}

const ROUND_TWO_DATABASE_STEPS = [
  { name: 'rbac-delta', run: applyRbacDelta },
  { name: 'client-backfill', run: backfillClientTaxDefaults },
  { name: 'sla-parity', run: ensureSlaParity },
] as const;

export async function flipProductCode(
  tenantId: string,
  log: SeedRunLog,
): Promise<void> {
  const affectedRows = await withAdminTransactionRetryReadOnly(async trx =>
    tenantDb(trx, tenantId)
      .table('tenants')
      .where({ tenant: tenantId, product_code: 'algadesk' })
      .update({ product_code: 'psa' }));

  if (affectedRows !== 1) {
    throw new Error(
      `Failed to flip product_code for tenant ${tenantId}: expected 1 algadesk tenant row, updated ${affectedRows}`,
    );
  }
  log.info('Tenant product_code flipped to psa', { tenantId });
}

async function getRbacDryRunPlan(
  tenantId: string,
): Promise<ProductUpgradeRolePermissionPlan[]> {
  const [knex, grants] = await Promise.all([
    getAdminConnection(),
    loadPsaRoleGrants(),
  ]);
  const db = tenantDb(knex, tenantId);
  const [roles, permissions] = await Promise.all([
    db.table<RoleRow>('roles')
      .where({ tenant: tenantId })
      .select('tenant', 'role_id', 'role_name', 'msp', 'client'),
    db.table<PermissionRow>('permissions')
      .where({ tenant: tenantId })
      .select('tenant', 'permission_id', 'resource', 'action', 'msp', 'client'),
  ]);
  const mappedRoleIds = roles
    .filter(role =>
      (isRoleInScope(role, 'msp')
        && Object.prototype.hasOwnProperty.call(grants.msp, role.role_name))
      || (isRoleInScope(role, 'client')
        && Object.prototype.hasOwnProperty.call(grants.client, role.role_name)))
    .map(role => role.role_id);
  const existingRows = mappedRoleIds.length === 0
    ? []
    : await db.table('role_permissions')
      .where({ tenant: tenantId })
      .whereIn('role_id', mappedRoleIds)
      .select('role_id', 'permission_id');
  const existing = new Set(existingRows.map(row => `${row.role_id}:${row.permission_id}`));
  const plan: ProductUpgradeRolePermissionPlan[] = [];

  for (const scope of ['msp', 'client'] as const) {
    for (const [roleName, grant] of Object.entries(grants[scope])) {
      const matchingRoles = roles.filter(role =>
        role.role_name === roleName && isRoleInScope(role, scope));
      const { permissionIds, skippedUnknownKeys } = resolveGrantPermissionIds(
        grant,
        grants.allMsp,
        permissions,
      );
      const rowsWouldInsert = matchingRoles.reduce((count, role) =>
        count + permissionIds.filter(permissionId =>
          !existing.has(`${role.role_id}:${permissionId}`)).length, 0);
      plan.push({
        roleName,
        scope,
        roleExists: matchingRoles.length > 0,
        rowsWouldInsert,
        skippedUnknownKeys,
      });
    }
  }

  return plan;
}

async function countUsersNeedingTechnicianRole(tenantId: string): Promise<number> {
  const knex = await getAdminConnection();
  const db = tenantDb(knex, tenantId);
  const roles = await db.table<RoleRow>('roles')
    .where({ tenant: tenantId })
    .whereIn('role_name', ['Agent', 'Technician'])
    .select('tenant', 'role_id', 'role_name', 'msp', 'client');
  const agentRole = roles.find(role =>
    role.role_name === 'Agent' && isRoleInScope(role, 'msp'));
  if (!agentRole) {
    return 0;
  }

  const agentRows = await db.table('user_roles')
    .where({ tenant: tenantId, role_id: agentRole.role_id })
    .select('user_id');
  const agentUserIds = [...new Set(agentRows.map(row => row.user_id as string))];
  const technicianRole = roles.find(role =>
    role.role_name === 'Technician' && isRoleInScope(role, 'msp'));
  if (!technicianRole || agentUserIds.length === 0) {
    return agentUserIds.length;
  }

  const technicianRows = await db.table('user_roles')
    .where({ tenant: tenantId, role_id: technicianRole.role_id })
    .whereIn('user_id', agentUserIds)
    .select('user_id');
  const technicianUserIds = new Set(technicianRows.map(row => row.user_id as string));
  return agentUserIds.filter(userId => !technicianUserIds.has(userId)).length;
}

async function countClientsMissingTaxSettings(tenantId: string): Promise<number> {
  const knex = await getAdminConnection();
  const db = tenantDb(knex, tenantId);
  // Keep client tax reads single-table because these tables may be Citus-local.
  const [clients, settings] = await Promise.all([
    db.table('clients')
      .where({ tenant: tenantId })
      .select('client_id'),
    db.table('client_tax_settings')
      .where({ tenant: tenantId })
      .select('client_id'),
  ]);
  const configuredClientIds = new Set(settings.map(row => row.client_id as string));
  return clients.filter(client => !configuredClientIds.has(client.client_id)).length;
}

async function countItilBoardsMissingSla(tenantId: string): Promise<number> {
  const knex = await getAdminConnection();
  const rows = await tenantDb(knex, tenantId)
    .table('boards')
    .where({ tenant: tenantId, priority_type: 'itil' })
    .whereNull('sla_policy_id')
    .select('board_id');
  return rows.length;
}

export async function verifyProductUpgrade(
  tenantId: string,
  log: SeedRunLog,
): Promise<void> {
  const knex = await getAdminConnection();
  const db = tenantDb(knex, tenantId);
  const tenant = await db
    .table<TenantRow>('tenants')
    .where({ tenant: tenantId })
    .first('product_code') as Pick<TenantRow, 'product_code'> | undefined;
  const [roleStatuses, activeTaxRateExists, grants, roles, permissions] = await Promise.all([
    getRoleStatuses(tenantId),
    hasActiveTaxRate(tenantId),
    loadPsaRoleGrants(),
    db.table<RoleRow>('roles')
      .where({ tenant: tenantId })
      .select('tenant', 'role_id', 'role_name', 'msp', 'client'),
    db.table<PermissionRow>('permissions')
      .where({ tenant: tenantId })
      .select('tenant', 'permission_id', 'resource', 'action', 'msp', 'client'),
  ]);
  const failures: string[] = [];

  if (!tenant) {
    failures.push('tenant row does not exist');
  } else if (tenant.product_code !== 'psa') {
    failures.push(`product_code is "${tenant.product_code ?? 'null'}", expected "psa"`);
  }
  for (const role of roleStatuses.filter(status => !status.exists)) {
    failures.push(`missing ${role.scope} role "${role.roleName}" with strict portal flags`);
  }
  if (!activeTaxRateExists) {
    failures.push('no active tenant tax rate exists');
  }

  // Keep client tax reads single-table because these tables may be Citus-local.
  const [clients, taxSettings, itilBoardsMissingSla] = await Promise.all([
    db.table('clients')
      .where({ tenant: tenantId })
      .select('client_id'),
    db.table('client_tax_settings')
      .where({ tenant: tenantId })
      .select('client_id'),
    db.table('boards')
      .where({ tenant: tenantId, priority_type: 'itil' })
      .whereNull('sla_policy_id')
      .select('board_id'),
  ]);
  const clientIdsWithTaxSettings = new Set(taxSettings.map(row => row.client_id as string));
  const missingTaxSettings = clients.filter(client =>
    !clientIdsWithTaxSettings.has(client.client_id));
  if (missingTaxSettings.length > 0) {
    failures.push(`${missingTaxSettings.length} clients are missing client_tax_settings rows`);
  }
  if (itilBoardsMissingSla.length > 0) {
    failures.push(`${itilBoardsMissingSla.length} ITIL-priority boards have no SLA policy`);
  }

  const agentRole = roles.find(role =>
    role.role_name === 'Agent' && isRoleInScope(role, 'msp'));
  const technicianRole = roles.find(role =>
    role.role_name === 'Technician' && isRoleInScope(role, 'msp'));
  if (agentRole && technicianRole) {
    const agentRows = await db.table('user_roles')
      .where({ tenant: tenantId, role_id: agentRole.role_id })
      .select('user_id');
    const agentUserIds = [...new Set(agentRows.map(row => row.user_id as string))];
    const technicianRows = agentUserIds.length === 0
      ? []
      : await db.table('user_roles')
        .where({ tenant: tenantId, role_id: technicianRole.role_id })
        .whereIn('user_id', agentUserIds)
        .select('user_id');
    const technicianUserIds = new Set(technicianRows.map(row => row.user_id as string));
    const missingTechnicianRole = agentUserIds.filter(userId =>
      !technicianUserIds.has(userId));
    if (missingTechnicianRole.length > 0) {
      failures.push(`${missingTechnicianRole.length} Agent users do not also hold Technician`);
    }
  }

  const technicianGrant = grants.msp.Technician;
  if (technicianRole && technicianGrant) {
    const { permissionIds, skippedUnknownKeys } = resolveGrantPermissionIds(
      technicianGrant,
      grants.allMsp,
      permissions,
    );
    const technicianRolePermissions = await db.table('role_permissions')
      .where({ tenant: tenantId, role_id: technicianRole.role_id })
      .select('permission_id');
    const requiredGrantCount = Array.isArray(technicianGrant)
      ? technicianGrant.length - skippedUnknownKeys
      : permissionIds.length;
    if (technicianRolePermissions.length < requiredGrantCount) {
      failures.push(
        `Technician has ${technicianRolePermissions.length} grants, expected at least ${requiredGrantCount}`,
      );
    }
  }

  if (failures.length > 0) {
    const message = `Product upgrade verification failed for tenant ${tenantId}: ${failures.join('; ')}`;
    log.error(message, { tenantId, failures });
    throw new Error(message);
  }
  log.info('Product upgrade verification passed', { tenantId });
}

async function buildDryRunPlan(
  tenant: ProductUpgradeTenantInfo,
  log: SeedRunLog,
): Promise<ProductUpgradeDryRunPlan> {
  const [
    seedFilesWouldRun,
    roles,
    activeTaxRateExists,
    rolePermissionInserts,
    usersNeedingTechnicianRole,
    clientsMissingTaxSettings,
    itilBoardsMissingSla,
  ] = await Promise.all([
    listPsaBackfillSeedFiles(),
    getRoleStatuses(tenant.tenantId),
    hasActiveTaxRate(tenant.tenantId),
    getRbacDryRunPlan(tenant.tenantId),
    countUsersNeedingTechnicianRole(tenant.tenantId),
    countClientsMissingTaxSettings(tenant.tenantId),
    countItilBoardsMissingSla(tenant.tenantId),
  ]);
  const plan: ProductUpgradeDryRunPlan = {
    mode: 'dry-run',
    tenant,
    seedFilesWouldRun,
    roles,
    activeTaxRateExists,
    rolePermissionInserts,
    usersNeedingTechnicianRole,
    clientsMissingTaxSettings,
    itilBoardsMissingSla,
  };
  log.info('Product upgrade dry-run plan prepared; no writes were performed', { plan });
  return plan;
}

export async function runProductUpgrade(
  tenantId: string,
  opts: RunProductUpgradeOptions,
): Promise<ProductUpgradeResult> {
  if (opts.dryRun && opts.flipOnly) {
    throw new Error('dryRun and flipOnly cannot be used together');
  }
  if (opts.dryRun && opts.skipStripe) {
    throw new Error('dryRun and skipStripe cannot be used together');
  }
  if (opts.flipOnly && opts.skipStripe) {
    throw new Error('flipOnly and skipStripe cannot be used together');
  }

  const tenant = await preflightProductUpgrade(tenantId, opts.log);
  if (opts.dryRun) {
    return buildDryRunPlan(tenant, opts.log);
  }

  if (opts.flipOnly) {
    await flipProductCode(tenantId, opts.log);
    await verifyProductUpgrade(tenantId, opts.log);
    return {
      mode: 'complete',
      tenant,
      seedsApplied: [],
      completedSteps: ['preflight', 'flip', 'verify'],
      flipWithheld: false,
    };
  }

  const completedSteps = ['preflight'];
  const seedsApplied = await backfillPsaSeeds(tenantId, opts.log);
  completedSteps.push('seed-backfill');

  for (const step of ROUND_TWO_DATABASE_STEPS) {
    await step.run(tenantId, opts.log);
    completedSteps.push(step.name);
  }

  if (opts.skipStripe) {
    opts.log.info(
      'Stripe swap skipped; product_code flip withheld. Run again with --flip after the Stripe swap',
      { tenantId },
    );
    return {
      mode: 'staged',
      tenant,
      seedsApplied,
      completedSteps,
      flipWithheld: true,
    };
  }

  await swapStripeProduct(tenantId, opts.log);
  completedSteps.push('stripe-swap');
  await flipProductCode(tenantId, opts.log);
  completedSteps.push('flip');
  await verifyProductUpgrade(tenantId, opts.log);
  completedSteps.push('verify');

  return {
    mode: 'complete',
    tenant,
    seedsApplied,
    completedSteps,
    flipWithheld: false,
  };
}
