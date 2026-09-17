// Keep legacy server imports on the shared process-wide event bus. A second
// consumer in the same Redis group would acknowledge events before package
// subscribers (including enterprise calendar sync) receive them.
export { EventBus, getEventBus, isEventBusConnected } from '@alga-psa/event-bus';
