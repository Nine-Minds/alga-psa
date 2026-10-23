import { publishWorkflowEvent, publishEvent, getEventBus } from './publishers';
import { buildThingCreatedPayload } from './builders';

export async function createThing(id: string) {
  const payload = buildThingCreatedPayload({ thingId: id });
  await publishWorkflowEvent({ eventType: 'THING_CREATED', payload, ctx: {} });
  await publishEvent({ eventType: 'THING_TOUCHED', payload: {} });
  await getEventBus().publish({ eventType: 'THING_TOUCHED', payload: {} });
}
