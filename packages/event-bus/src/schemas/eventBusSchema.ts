// Keep event-bus schema definitions in sync with the canonical source.
// This avoids drift where publishers emit valid domain events that this package rejects.
export * from '../../../event-schemas/src/schemas/eventBusSchema';
