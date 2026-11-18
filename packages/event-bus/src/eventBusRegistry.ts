/**
 * Process-wide key under which the single EventBus instance is registered on
 * `globalThis`.
 *
 * Next's main and EE graphs can bundle the event bus module independently, so
 * the instance cannot live in module scope: every copy of the module must find
 * the same consumer. The key is a registered symbol for the same reason, and
 * it lives in this leaf module so code that has to find the instance without
 * loading the bus (test isolation, for one) shares the definition.
 */
export const EVENT_BUS_REGISTRY_KEY = Symbol.for('alga.eventBus.v1');
