import type { EventType } from '@alga-psa/event-schemas';
import type { CommentEventType } from '@alga-psa/db/commentEventRegistry';

export * from '@alga-psa/db/commentEventRegistry';

// @alga-psa/db cannot import the event-bus schema, so the comment registry's event
// names are proven to be EventType members here: a typo or a removed event fails tsc.
type AssertSubtype<T extends U, U> = T;
export type CommentEventTypesAreEventTypes = AssertSubtype<CommentEventType, EventType>;
