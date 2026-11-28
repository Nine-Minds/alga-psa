/**
 * Tenant Stripe API surface and the restricted-key access each capability uses.
 * Stripe does not provide a side-effect-free, reliable probe for every write;
 * permissions without a verified probe are checked by their actual operation.
 */
export type StripeCapability = 'webhooks' | 'core-payments' | 'saved-cards-auto-pay' | 'customer-import';
export type StripePermissionStatus = 'granted' | 'denied' | 'unchecked';
export type StripeAccess = 'read' | 'write';

export interface StripePermissionDefinition {
  id: string;
  access: StripeAccess;
  writeImpliesRead?: true;
  operations: string[];
  capabilities: StripeCapability[];
  probe: { kind: 'list'; operation: string } | { kind: 'first-use'; reason: string };
}

export const STRIPE_PERMISSION_MANIFEST: StripePermissionDefinition[] = [
  { id: 'webhook_read', access: 'read', operations: ['webhookEndpoints.list', 'webhookEndpoints.retrieve'], capabilities: ['webhooks'], probe: { kind: 'list', operation: 'webhookEndpoints.list' } },
  { id: 'webhook_write', access: 'write', writeImpliesRead: true, operations: ['webhookEndpoints.create', 'webhookEndpoints.update', 'webhookEndpoints.del'], capabilities: ['webhooks'], probe: { kind: 'first-use', reason: 'Stripe authorization-before-resource-existence behavior has not been verified live.' } },
  { id: 'checkout_session_write', access: 'write', writeImpliesRead: true, operations: ['checkout.sessions.create', 'checkout.sessions.expire'], capabilities: ['core-payments', 'saved-cards-auto-pay'], probe: { kind: 'first-use', reason: 'A safe write probe has not been verified live.' } },
  { id: 'checkout_session_read', access: 'read', operations: ['checkout.sessions.retrieve', 'checkout.sessions.list'], capabilities: ['core-payments'], probe: { kind: 'list', operation: 'checkout.sessions.list' } },
  { id: 'customer_read', access: 'read', operations: ['customers.retrieve', 'customers.list'], capabilities: ['core-payments', 'saved-cards-auto-pay', 'customer-import'], probe: { kind: 'list', operation: 'customers.list' } },
  { id: 'customer_write', access: 'write', writeImpliesRead: true, operations: ['customers.create', 'customers.update'], capabilities: ['core-payments', 'customer-import'], probe: { kind: 'first-use', reason: 'A safe write probe has not been verified live.' } },
  { id: 'payment_intent_read', access: 'read', operations: ['paymentIntents.retrieve', 'paymentIntents.search', 'paymentIntents.list'], capabilities: ['core-payments', 'saved-cards-auto-pay', 'customer-import'], probe: { kind: 'list', operation: 'paymentIntents.list' } },
  { id: 'payment_intent_write', access: 'write', writeImpliesRead: true, operations: ['paymentIntents.create'], capabilities: ['saved-cards-auto-pay'], probe: { kind: 'first-use', reason: 'A safe write probe has not been verified live.' } },
  { id: 'payment_method_read', access: 'read', operations: ['customers.listPaymentMethods', 'paymentMethods.retrieve', 'paymentMethods.list'], capabilities: ['saved-cards-auto-pay', 'customer-import'], probe: { kind: 'list', operation: 'paymentMethods.list' } },
  { id: 'payment_method_write', access: 'write', writeImpliesRead: true, operations: ['paymentMethods.detach', 'paymentMethods.update'], capabilities: ['saved-cards-auto-pay', 'customer-import'], probe: { kind: 'first-use', reason: 'A safe write probe has not been verified live.' } },
  { id: 'setup_intent_read', access: 'read', operations: ['setupIntents.list', 'setupIntents.retrieve'], capabilities: ['saved-cards-auto-pay', 'customer-import'], probe: { kind: 'list', operation: 'setupIntents.list' } },
  { id: 'charge_read', access: 'read', operations: ['charges.retrieve', 'charges.list'], capabilities: ['core-payments'], probe: { kind: 'list', operation: 'charges.list' } },
];

export const STRIPE_CAPABILITIES: StripeCapability[] = ['webhooks', 'core-payments', 'saved-cards-auto-pay', 'customer-import'];
export const STRIPE_REQUIRED_CAPABILITIES: StripeCapability[] = ['webhooks', 'core-payments'];

export function isValidStripeSecretKey(value: unknown): value is string {
  return typeof value === 'string' && /^(sk|rk)_(live|test)_[A-Za-z0-9]+$/.test(value);
}

export function isStripePermissionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { type?: unknown; name?: unknown; statusCode?: unknown; status?: unknown };
  return candidate.type === 'StripePermissionError' || candidate.name === 'StripePermissionError';
}

export function getStripePermissionId(error: unknown, operation?: string): string | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as { type?: unknown; code?: unknown; raw?: { message?: unknown }; message?: unknown };
  // Stripe reports restricted-key failures as InvalidRequestError. Keep the
  // parser narrow so authentication and transient errors retain their meaning.
  const permissionError = isStripePermissionError(error);
  if (!permissionError && candidate.type !== 'StripeInvalidRequestError' && candidate.type !== 'invalid_request_error') return null;
  const message = [candidate.message, candidate.raw?.message].filter((v): v is string => typeof v === 'string').join(' ');
  const match = message.match(/\b([a-z]+(?:_[a-z]+)*_(?:read|write))\b/i);
  if (match) return match[1];
  if (!permissionError) return null;
  return STRIPE_PERMISSION_MANIFEST.find((permission) => permission.operations.includes(operation ?? ''))?.id ?? null;
}

export function describeStripePermissionFailure(permissionId: string): string {
  const definition = STRIPE_PERMISSION_MANIFEST.find((permission) => permission.id === permissionId);
  if (!definition) return `Stripe permission ${permissionId} is missing.`;
  return `Stripe capability ${definition.capabilities.join(', ')} is unavailable: missing permission ${permissionId}.`;
}

/** Translate deferred SDK denials at the operation boundary that raised them. */
export function withStripePermissionErrors<T extends object>(client: T): T {
  const wrap = (target: object, path: string[], permissionOperation?: string): object => new Proxy(target, {
    get(current, property) {
      const value = Reflect.get(current, property, current);
      if (typeof value === 'function') {
        const operation = permissionOperation ?? [...path, String(property)].join('.');
        // Await/then on an SDK list consumes the first page directly.
        if (permissionOperation && (property === 'then' || property === 'catch' || property === 'finally')) {
          const firstPage = (current as Promise<unknown>).catch((error) => { throw translate(error, operation); });
          return firstPage[property].bind(firstPage);
        }
        return function (this: unknown, ...args: unknown[]) {
          let result: unknown;
          try { result = Reflect.apply(value, current, args); }
          catch (error) { throw translate(error, operation); }
          // Stripe returns an augmented Promise for list methods. Replacing it
          // with `.catch()` drops autoPagingToArray/autoPagingEach. Keep a
          // proxy over the original object and translate errors from paging.
          if (result && typeof result === 'object' && typeof (result as any).autoPagingToArray === 'function') {
            return wrap(result, [...path, String(property)], operation);
          }
          if (result && typeof (result as Promise<unknown>).then === 'function') {
            return (result as Promise<unknown>).catch((error) => { throw translate(error, operation); });
          }
          return result;
        };
      }
      if (value && typeof value === 'object') return wrap(value, [...path, String(property)], permissionOperation);
      return value;
    },
  });
  const translate = (error: unknown, operation: string): unknown => {
    const permissionId = getStripePermissionId(error, operation);
    if (!permissionId) return error;
    return new Error(describeStripePermissionFailure(permissionId), { cause: error });
  };
  return wrap(client, []) as T;
}

export function listStripePermissionsByCapability() {
  return STRIPE_CAPABILITIES.map((capability) => ({
    capability,
    permissions: STRIPE_PERMISSION_MANIFEST.filter((permission) => permission.capabilities.includes(capability)),
  }));
}

export function findUncoveredStripeOperations(source: string): string[] {
  const covered = new Set(STRIPE_PERMISSION_MANIFEST.flatMap(({ operations }) => operations));
  const found = new Set<string>();
  const call = /(?:stripe|\(await\s+this\.getStripe\(\)\))\.((?:[A-Za-z]+\.){1,2}[A-Za-z]+)\s*\(/g;
  for (const match of source.matchAll(call)) {
    const operation = match[1];
    // Account retrieval is deliberately best-effort: Stripe's permission
    // reference does not assign GET /v1/account a restricted-key permission.
    if (operation !== 'accounts.retrieve' && !covered.has(operation)) found.add(operation);
  }
  return [...found].sort();
}
