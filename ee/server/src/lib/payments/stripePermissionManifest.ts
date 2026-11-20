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
  { id: 'checkout_session_read', access: 'read', operations: ['checkout.sessions.retrieve'], capabilities: ['core-payments'], probe: { kind: 'first-use', reason: 'No harmless list probe exists for this operation.' } },
  { id: 'customer_read', access: 'read', operations: ['customers.retrieve', 'customers.list'], capabilities: ['core-payments', 'saved-cards-auto-pay', 'customer-import'], probe: { kind: 'list', operation: 'customers.list' } },
  { id: 'customer_write', access: 'write', writeImpliesRead: true, operations: ['customers.create', 'customers.update'], capabilities: ['core-payments'], probe: { kind: 'first-use', reason: 'A safe write probe has not been verified live.' } },
  { id: 'payment_intent_read', access: 'read', operations: ['paymentIntents.retrieve', 'paymentIntents.search', 'paymentIntents.list'], capabilities: ['core-payments', 'saved-cards-auto-pay', 'customer-import'], probe: { kind: 'list', operation: 'paymentIntents.list' } },
  { id: 'payment_intent_write', access: 'write', writeImpliesRead: true, operations: ['paymentIntents.create'], capabilities: ['saved-cards-auto-pay'], probe: { kind: 'first-use', reason: 'A safe write probe has not been verified live.' } },
  { id: 'payment_method_read', access: 'read', operations: ['customers.listPaymentMethods', 'paymentMethods.retrieve'], capabilities: ['saved-cards-auto-pay', 'customer-import'], probe: { kind: 'first-use', reason: 'No harmless list probe exists for this operation.' } },
  { id: 'payment_method_write', access: 'write', writeImpliesRead: true, operations: ['paymentMethods.detach'], capabilities: ['saved-cards-auto-pay'], probe: { kind: 'first-use', reason: 'A safe write probe has not been verified live.' } },
  { id: 'setup_intent_read', access: 'read', operations: ['setupIntents.list'], capabilities: ['customer-import'], probe: { kind: 'list', operation: 'setupIntents.list' } },
  { id: 'charge_read', access: 'read', operations: ['charges.retrieve'], capabilities: ['core-payments'], probe: { kind: 'first-use', reason: 'No harmless list probe exists for this operation.' } },
];

export const STRIPE_CAPABILITIES: StripeCapability[] = ['webhooks', 'core-payments', 'saved-cards-auto-pay', 'customer-import'];
export const STRIPE_REQUIRED_CAPABILITIES: StripeCapability[] = ['webhooks', 'core-payments'];

export function isValidStripeSecretKey(value: unknown): value is string {
  return typeof value === 'string' && /^(sk|rk)_(live|test)_[A-Za-z0-9]+$/.test(value);
}

export function getStripePermissionId(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as { type?: unknown; code?: unknown; raw?: { message?: unknown }; message?: unknown };
  // Stripe reports restricted-key failures as InvalidRequestError. Keep the
  // parser narrow so authentication and transient errors retain their meaning.
  if (candidate.type !== 'StripeInvalidRequestError' && candidate.type !== 'invalid_request_error') return null;
  const message = [candidate.message, candidate.raw?.message].filter((v): v is string => typeof v === 'string').join(' ');
  const match = message.match(/\b([a-z]+(?:_[a-z]+)*_(?:read|write))\b/i);
  return match?.[1] ?? null;
}

export function describeStripePermissionFailure(permissionId: string): string {
  const definition = STRIPE_PERMISSION_MANIFEST.find((permission) => permission.id === permissionId);
  if (!definition) return `Stripe permission ${permissionId} is missing.`;
  return `Stripe capability ${definition.capabilities.join(', ')} is unavailable: missing permission ${permissionId}.`;
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
  const call = /stripe\.([A-Za-z]+(?:\.[A-Za-z]+)?)\.([A-Za-z]+)\s*\(/g;
  for (const match of source.matchAll(call)) {
    const operation = `${match[1]}.${match[2]}`;
    // Account retrieval is deliberately best-effort: Stripe's permission
    // reference does not assign GET /v1/account a restricted-key permission.
    if (operation !== 'accounts.retrieve' && !covered.has(operation)) found.add(operation);
  }
  return [...found].sort();
}
