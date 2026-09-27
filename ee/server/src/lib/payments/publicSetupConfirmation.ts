import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

function getEncryptionKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET is required for public setup confirmation context');
  return scryptSync(secret, 'stripe-card-setup-context', 32);
}

export type PublicSetupContext = { tenantId: string; clientId: string; billingProfileId: string };

export function createPublicSetupTenantContext(context: PublicSetupContext): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(context), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

export function resolvePublicSetupTenantContext(token: string): PublicSetupContext {
  try {
    const bytes = Buffer.from(token, 'base64url');
    const iv = bytes.subarray(0, 12);
    const tag = bytes.subarray(12, 28);
    const encrypted = bytes.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    const context = JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')) as PublicSetupContext;
    if (![context.tenantId, context.clientId, context.billingProfileId].every((id) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id))) throw new Error('Invalid setup context');
    return context;
  } catch {
    throw new Error('Invalid public setup context');
  }
}

export function buildSetupSuccessUrl(baseUrl: string, context: PublicSetupContext, publicConfirmation: boolean, returnTo: string): string {
  if (publicConfirmation) {
    const token = createPublicSetupTenantContext(context);
    return `${baseUrl}/payment-methods/setup-complete?tenantContext=${encodeURIComponent(token)}&session_id={CHECKOUT_SESSION_ID}`;
  }
  const safeReturnTo = returnTo.startsWith('/') && !returnTo.startsWith('//') && !returnTo.startsWith('/msp/') ? returnTo : '/client-portal/billing';
  return `${baseUrl}/client-portal/billing/payment-methods/setup-complete?session_id={CHECKOUT_SESSION_ID}&returnTo=${encodeURIComponent(safeReturnTo)}`;
}
