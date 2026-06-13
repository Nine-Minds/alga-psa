import type { Knex } from 'knex';
import { getActionRegistryV2 } from '../../../../../shared/workflow/runtime/registries/actionRegistry';
import type { ActionRegistry } from '../../../../../shared/workflow/runtime/registries/actionRegistry';
import {
  getWorkflowIntegrationModuleRegistry,
  type WorkflowIntegrationModuleDefinition
} from '../../../../../shared/workflow/runtime/registries/integrationModuleRegistry';
import {
  getWorkflowModuleAvailabilityRegistry,
  type WorkflowModuleAvailabilityResolver
} from '../../../../../shared/workflow/runtime/registries/moduleAvailabilityRegistry';

export type IntegrationWorkflowModuleRegistration = {
  module: WorkflowIntegrationModuleDefinition;
  availability: WorkflowModuleAvailabilityResolver;
  registerActions: (registry: ActionRegistry) => void;
};

/**
 * Registers a first-party integration's workflow module in one call: its
 * actions, its palette tile, and the availability resolver that gates the
 * tile to tenants with the integration connected. Idempotent so repeated
 * runtime initialization does not duplicate registrations.
 */
export function registerIntegrationWorkflowModule(input: IntegrationWorkflowModuleRegistration): void {
  const { module: moduleDefinition, availability, registerActions } = input;
  if (!moduleDefinition.availabilityKey) {
    throw new Error(`Integration module ${moduleDefinition.groupKey} requires availabilityKey`);
  }

  registerActions(getActionRegistryV2());

  const moduleRegistry = getWorkflowIntegrationModuleRegistry();
  if (!moduleRegistry.list().some((module) => module.groupKey === moduleDefinition.groupKey)) {
    moduleRegistry.register(moduleDefinition);
  }

  const availabilityRegistry = getWorkflowModuleAvailabilityRegistry();
  if (!availabilityRegistry.has(moduleDefinition.availabilityKey)) {
    availabilityRegistry.register(moduleDefinition.availabilityKey, availability);
  }
}

/**
 * Resolves which integration module tiles are available for a tenant by
 * running each module's registered availability resolver. A module whose
 * availabilityKey has no resolver is unavailable (fail closed), and a
 * resolver failure hides the tile rather than breaking catalog listing.
 */
export async function resolveAvailableIntegrationModuleKeys(
  knex: Knex,
  tenantId: string | null | undefined
): Promise<Set<string>> {
  const available = new Set<string>();
  if (!tenantId) return available;
  const moduleRegistry = getWorkflowIntegrationModuleRegistry();
  const availabilityRegistry = getWorkflowModuleAvailabilityRegistry();
  for (const module of moduleRegistry.list()) {
    if (!module.availabilityKey) continue;
    const resolver = availabilityRegistry.get(module.availabilityKey);
    if (!resolver) continue;
    try {
      if (await resolver(knex, tenantId)) available.add(module.groupKey);
    } catch {
      continue;
    }
  }
  return available;
}

/**
 * Shared availability check for RMM-backed modules: the tenant has an
 * active, connected rmm_integrations row for the provider.
 */
export function rmmIntegrationAvailability(provider: string): WorkflowModuleAvailabilityResolver {
  return async (knex: Knex, tenantId: string): Promise<boolean> => {
    const row = await knex('rmm_integrations')
      .where({ tenant: tenantId, provider, is_active: true })
      .whereNotNull('connected_at')
      .first();
    return Boolean(row);
  };
}
