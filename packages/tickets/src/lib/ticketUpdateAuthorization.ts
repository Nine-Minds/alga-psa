/** Capability passed only by trusted server code; it cannot be recreated from action JSON. */
export const AUTO_CLOSE_TICKET_AUTHORIZATION: unique symbol = Symbol('auto-close-ticket-authorization');

/** Reject option payloads that are not on the wrapper's runtime allowlist. */
export function assertAllowedTicketUpdateOptions(
  options: unknown,
  allowedKeys: readonly string[],
): void {
  if (options === undefined) return;
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('Invalid ticket update options');
  }
  const prototype = Object.getPrototypeOf(options);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('Invalid ticket update options');
  }

  const allowed = new Set(allowedKeys);
  const unsupported = Reflect.ownKeys(options).filter((key) => typeof key !== 'string' || !allowed.has(key));
  if (unsupported.length > 0) {
    throw new Error(`Unsupported ticket update option: ${unsupported.map(String).join(', ')}`);
  }
}
