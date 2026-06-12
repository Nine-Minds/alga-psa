import type { WorkflowDesignerCatalogKind } from '../designer/actionCatalog';

export type WorkflowIntegrationModuleDefinition = {
  groupKey: `app:${string}`;
  label: string;
  description?: string;
  tileKind: Extract<WorkflowDesignerCatalogKind, 'app'>;
  iconToken: string;
  defaultActionId?: string;
  allowedActionIds: string[];
  availabilityKey?: string;
};

export class WorkflowIntegrationModuleRegistry {
  private modules = new Map<string, WorkflowIntegrationModuleDefinition>();

  register(definition: WorkflowIntegrationModuleDefinition): void {
    const key = definition.groupKey.trim();
    if (!key) throw new Error('WorkflowIntegrationModuleRegistry.register requires groupKey');
    if (this.modules.has(key)) {
      throw new Error(`WorkflowIntegrationModuleRegistry already has ${key}`);
    }
    this.modules.set(key, {
      ...definition,
      groupKey: key as `app:${string}`,
      allowedActionIds: [...new Set(definition.allowedActionIds.map((id) => id.trim()).filter(Boolean))]
    });
  }

  list(): WorkflowIntegrationModuleDefinition[] {
    return Array.from(this.modules.values()).sort((left, right) => left.label.localeCompare(right.label));
  }
}

let moduleRegistryInstance: WorkflowIntegrationModuleRegistry | null = null;

export function getWorkflowIntegrationModuleRegistry(): WorkflowIntegrationModuleRegistry {
  if (!moduleRegistryInstance) {
    moduleRegistryInstance = new WorkflowIntegrationModuleRegistry();
  }
  return moduleRegistryInstance;
}
