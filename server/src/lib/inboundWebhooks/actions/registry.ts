export type InboundActionTargetFieldType = 'string' | 'int' | 'number' | 'boolean' | 'enum' | 'json' | 'ref';

export interface InboundActionTargetField {
  name: string;
  type: InboundActionTargetFieldType;
  required: boolean;
  description: string;
  enumValues?: string[];
  refEntityType?: string;
}

export interface InboundActionContext {
  tenant: string;
  webhookSlug: string;
  deliveryId: string;
  headers: Record<string, string | string[]>;
  rawBody: unknown;
  idempotencyKey: string | null;
}

export interface InboundActionResult {
  success: boolean;
  entityType?: string;
  entityId?: string;
  externalId?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface InboundActionDefinition<TMappedValues extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  entityType: string;
  displayName: string;
  description: string;
  targetFields: InboundActionTargetField[];
  handle: (ctx: InboundActionContext, mappedValues: TMappedValues) => Promise<InboundActionResult>;
}

const actions = new Map<string, InboundActionDefinition>();

export function registerAction<TMappedValues extends Record<string, unknown>>(
  definition: InboundActionDefinition<TMappedValues>,
): void {
  if (actions.has(definition.name)) {
    throw new Error(`Inbound action "${definition.name}" is already registered`);
  }

  actions.set(definition.name, definition as InboundActionDefinition);
}

export function getAction(name: string): InboundActionDefinition | undefined {
  return actions.get(name);
}

export function listActions(): InboundActionDefinition[] {
  return [...actions.values()].sort((left, right) => {
    const entityCompare = left.entityType.localeCompare(right.entityType);
    return entityCompare === 0 ? left.name.localeCompare(right.name) : entityCompare;
  });
}

export function clearActionsForTest(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('clearActionsForTest may only be used in tests');
  }

  actions.clear();
}
