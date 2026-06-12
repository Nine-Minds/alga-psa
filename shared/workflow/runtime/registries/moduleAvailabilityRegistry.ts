import type { Knex } from 'knex';

/**
 * Decides whether an integration module's palette tile is available for a tenant.
 * Resolvers run on the designer catalog read path: they must be cheap and must
 * not throw for "not connected" — return false instead.
 */
export type WorkflowModuleAvailabilityResolver = (knex: Knex, tenantId: string) => Promise<boolean>;

export class WorkflowModuleAvailabilityRegistry {
  private resolvers = new Map<string, WorkflowModuleAvailabilityResolver>();

  register(availabilityKey: string, resolver: WorkflowModuleAvailabilityResolver): void {
    const key = availabilityKey.trim();
    if (!key) throw new Error('WorkflowModuleAvailabilityRegistry.register requires availabilityKey');
    if (this.resolvers.has(key)) {
      throw new Error(`WorkflowModuleAvailabilityRegistry already has ${key}`);
    }
    this.resolvers.set(key, resolver);
  }

  has(availabilityKey: string): boolean {
    return this.resolvers.has(availabilityKey.trim());
  }

  get(availabilityKey: string): WorkflowModuleAvailabilityResolver | undefined {
    return this.resolvers.get(availabilityKey.trim());
  }
}

let availabilityRegistryInstance: WorkflowModuleAvailabilityRegistry | null = null;

export function getWorkflowModuleAvailabilityRegistry(): WorkflowModuleAvailabilityRegistry {
  if (!availabilityRegistryInstance) {
    availabilityRegistryInstance = new WorkflowModuleAvailabilityRegistry();
  }
  return availabilityRegistryInstance;
}
