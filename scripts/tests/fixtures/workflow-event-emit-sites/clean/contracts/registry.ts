import { buildThingCreatedPayload } from '../builders';
export const contracts = { THING_CREATED: { cases: [{ build: () => buildThingCreatedPayload({ thingId: 'x' }) }] } };
