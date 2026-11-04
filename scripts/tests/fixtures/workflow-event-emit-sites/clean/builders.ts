import { builtWorkflowPayload } from './publishers';
export function buildThingCreatedPayload(input: { thingId: string }) {
  return builtWorkflowPayload('THING_CREATED', { thingId: input.thingId });
}
