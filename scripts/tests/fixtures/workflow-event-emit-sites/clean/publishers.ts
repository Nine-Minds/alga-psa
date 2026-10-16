import type { WorkflowCatalogEventType } from './catalog';
declare const brand: unique symbol;
export type BuiltWorkflowPayload<T extends WorkflowCatalogEventType> = { readonly [brand]: (t: T) => void };
export function builtWorkflowPayload<T extends WorkflowCatalogEventType, P extends object>(_t: T, p: P): P & BuiltWorkflowPayload<T> {
  return p as P & BuiltWorkflowPayload<T>;
}
export async function publishWorkflowEvent<T extends WorkflowCatalogEventType>(_p: { eventType: T; payload: BuiltWorkflowPayload<T>; ctx: object }): Promise<void> {}
export async function publishEvent(_e: { eventType: string; payload: Record<string, unknown> }): Promise<void> {}
export async function publishEventByName(_e: { eventType: string; payload: Record<string, unknown> }): Promise<void> {}
export async function publishUnregisteredEventType(_e: { eventType: string; payload: Record<string, unknown> }): Promise<void> {}
export class EventBus { async publish(_e: unknown): Promise<void> {} }
export function getEventBus(): EventBus { return new EventBus(); }
