/**
 * Operator-action inputs: what the trigger routes validate and what the
 * Temporal workflows receive as their single argument.
 *
 * Duplicated (not imported) in ee/temporal-workflows/src/workflows/appliance-console/types.ts
 * because the worker package does not resolve @ee imports; keep both in sync.
 */

export type ApplianceEditionInput = 'essentials' | 'pro' | 'premium';
export type ApplianceTierInput = 'pro' | 'premium';

export interface OperatorMeta {
  userId: string;
  userEmail: string | null;
}

interface BaseArgs {
  /** Audit row the trigger wrote; workflows echo it in their result for traceability. */
  auditLogId: string;
  operator: OperatorMeta;
  reason: string | null;
}

export interface CreateTenantArgs extends BaseArgs {
  companyName: string;
  contactName: string | null;
  contactEmail: string;
  edition: ApplianceEditionInput;
  productCode: 'psa' | 'algadesk';
  seats: number | null;
  /** Required for a paid edition unless `comp` is set. */
  stripeSubId: string | null;
  /** Paid edition without a subscription: register as essentials, then grant a comp key. */
  comp: { endsAt: number; note: string } | null;
}

export interface UpdateTenantArgs extends BaseArgs {
  tenantId: string;
  companyName?: string;
  contactName?: string | null;
  contactEmail?: string;
}

export interface ReissueInstallCodeArgs extends BaseArgs {
  tenantId: string;
}

export interface ReissueActivationCodeArgs extends BaseArgs {
  tenantId: string;
}

export interface AirgapKeyArgs extends BaseArgs {
  tenantId: string;
}

export interface ExtendProArgs extends BaseArgs {
  tenantId: string;
  /** Unix seconds. */
  endsAt: number;
  seats: number | null;
}

export type EntitlementChangeMode = 'comp' | 'billed';
export type ProrationBehavior = 'create_prorations' | 'none';

export interface ChangeEntitlementArgs extends BaseArgs {
  tenantId: string;
  mode: EntitlementChangeMode;
  /** Absent = unchanged; null = unlimited (comp mode only). */
  seats?: number | null;
  /** Absent = unchanged. */
  tier?: ApplianceTierInput;
  proration: ProrationBehavior;
}

export interface SetStatusArgs extends BaseArgs {
  tenantId: string;
  status: 'active' | 'suspended' | 'cancelled';
}

export interface RevokeArgs extends BaseArgs {
  tenantId: string;
  hard: boolean;
}

export interface RevokeApplianceArgs extends BaseArgs {
  tenantId: string;
  applianceId: string;
}

export type PauseCollectionBehavior = 'void' | 'keep_as_draft' | 'mark_uncollectible';

export interface BillingPauseArgs extends BaseArgs {
  tenantId: string;
  /** Unix seconds; omitted = paused until resumed by hand. */
  resumesAt: number | null;
  behavior: PauseCollectionBehavior;
}

export interface BillingResumeArgs extends BaseArgs {
  tenantId: string;
}

// ── Validation ─────────────────────────────────────────────────────────────────

export class ActionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionValidationError';
  }
}

type Body = Record<string, unknown>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Longest comp grant an operator can hand out in one action. */
export const MAX_COMP_DAYS = 90;

function str(body: Body, key: string, opts: { required?: boolean; max?: number } = {}): string | null {
  const v = body[key];
  if (v === undefined || v === null || v === '') {
    if (opts.required) throw new ActionValidationError(`${key} is required`);
    return null;
  }
  if (typeof v !== 'string') throw new ActionValidationError(`${key} must be a string`);
  const t = v.trim();
  if (!t && opts.required) throw new ActionValidationError(`${key} is required`);
  if (opts.max && t.length > opts.max) throw new ActionValidationError(`${key} is too long`);
  return t;
}

function reason(body: Body, required: boolean): string | null {
  return str(body, 'reason', { required, max: 1000 });
}

function positiveInt(body: Body, key: string): number | null {
  const v = body[key];
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
    throw new ActionValidationError(`${key} must be a positive integer`);
  }
  return n;
}

function unixFuture(body: Body, key: string, opts: { required: boolean; maxDays?: number }): number | null {
  const v = body[key];
  if (v === undefined || v === null || v === '') {
    if (opts.required) throw new ActionValidationError(`${key} is required`);
    return null;
  }
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new ActionValidationError(`${key} must be a unix timestamp (seconds)`);
  const ts = Math.floor(n);
  const now = Math.floor(Date.now() / 1000);
  if (ts <= now) throw new ActionValidationError(`${key} must be in the future`);
  if (opts.maxDays && ts > now + opts.maxDays * 86400) {
    throw new ActionValidationError(`${key} must be within ${opts.maxDays} days`);
  }
  return ts;
}

function oneOf<T extends string>(body: Body, key: string, allowed: readonly T[], required: boolean): T | null {
  const v = body[key];
  if (v === undefined || v === null || v === '') {
    if (required) throw new ActionValidationError(`${key} is required`);
    return null;
  }
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    throw new ActionValidationError(`${key} must be one of: ${allowed.join(', ')}`);
  }
  return v as T;
}

export function parseCreateTenant(body: Body, base: Omit<BaseArgs, 'reason'>): CreateTenantArgs {
  const companyName = str(body, 'company_name', { required: true, max: 200 })!;
  const contactEmail = str(body, 'contact_email', { required: true, max: 320 })!;
  if (!EMAIL_RE.test(contactEmail)) throw new ActionValidationError('contact_email is not a valid email');
  const edition = oneOf(body, 'edition', ['essentials', 'pro', 'premium'] as const, true)!;
  const productCode = oneOf(body, 'product_code', ['psa', 'algadesk'] as const, false) ?? 'psa';
  const seats = positiveInt(body, 'seats');
  const stripeSubId = str(body, 'stripe_sub_id', { max: 100 });
  let comp: CreateTenantArgs['comp'] = null;
  if (body.comp && typeof body.comp === 'object') {
    const c = body.comp as Body;
    comp = {
      endsAt: unixFuture(c, 'ends_at', { required: true, maxDays: MAX_COMP_DAYS })!,
      note: str(c, 'note', { required: true, max: 1000 })!,
    };
  }
  if (edition !== 'essentials' && !stripeSubId && !comp) {
    throw new ActionValidationError('A paid edition needs stripe_sub_id or comp');
  }
  if (stripeSubId && comp) throw new ActionValidationError('Provide stripe_sub_id or comp, not both');
  return {
    ...base,
    reason: reason(body, false),
    companyName,
    contactName: str(body, 'contact_name', { max: 200 }),
    contactEmail,
    edition,
    productCode,
    seats,
    stripeSubId,
    comp,
  };
}

export function parseUpdateTenant(body: Body, tenantId: string, base: Omit<BaseArgs, 'reason'>): UpdateTenantArgs {
  const companyName = str(body, 'company_name', { max: 200 });
  const contactEmail = str(body, 'contact_email', { max: 320 });
  const hasContactName = body.contact_name !== undefined;
  const contactName = hasContactName ? str(body, 'contact_name', { max: 200 }) : undefined;
  if (contactEmail && !EMAIL_RE.test(contactEmail)) throw new ActionValidationError('contact_email is not a valid email');
  if (!companyName && !contactEmail && !hasContactName) {
    throw new ActionValidationError('Nothing to update: provide company_name, contact_name or contact_email');
  }
  return {
    ...base,
    reason: reason(body, false),
    tenantId,
    ...(companyName ? { companyName } : {}),
    ...(hasContactName ? { contactName } : {}),
    ...(contactEmail ? { contactEmail } : {}),
  };
}

export function parseReissueInstallCode(body: Body, tenantId: string, base: Omit<BaseArgs, 'reason'>): ReissueInstallCodeArgs {
  return { ...base, reason: reason(body, false), tenantId };
}

export function parseReissueActivationCode(body: Body, tenantId: string, base: Omit<BaseArgs, 'reason'>): ReissueActivationCodeArgs {
  return { ...base, reason: reason(body, true), tenantId };
}

export function parseAirgapKey(body: Body, tenantId: string, base: Omit<BaseArgs, 'reason'>): AirgapKeyArgs {
  return { ...base, reason: reason(body, false), tenantId };
}

export function parseExtendPro(body: Body, tenantId: string, base: Omit<BaseArgs, 'reason'>): ExtendProArgs {
  return {
    ...base,
    reason: reason(body, true),
    tenantId,
    endsAt: unixFuture(body, 'ends_at', { required: true, maxDays: MAX_COMP_DAYS })!,
    seats: positiveInt(body, 'seats'),
  };
}

export function parseChangeEntitlement(body: Body, tenantId: string, base: Omit<BaseArgs, 'reason'>): ChangeEntitlementArgs {
  const mode = oneOf(body, 'mode', ['comp', 'billed'] as const, true)!;
  // `seats: null` is an explicit "unlimited"; an absent key leaves seats unchanged.
  const seatsProvided = 'seats' in body && body.seats !== undefined && body.seats !== '';
  const seats = seatsProvided ? (body.seats === null ? null : positiveInt(body, 'seats')) : undefined;
  const tier = oneOf(body, 'tier', ['pro', 'premium'] as const, false) ?? undefined;
  if (!seatsProvided && !tier) throw new ActionValidationError('seats or tier is required');
  if (mode === 'billed' && seats === null) throw new ActionValidationError('Unlimited seats cannot be billed; use comp mode');
  const proration = oneOf(body, 'proration', ['create_prorations', 'none'] as const, false) ?? 'create_prorations';
  return {
    ...base,
    reason: reason(body, true),
    tenantId,
    mode,
    ...(seatsProvided ? { seats } : {}),
    ...(tier ? { tier } : {}),
    proration,
  };
}

export function parseSetStatus(body: Body, tenantId: string, base: Omit<BaseArgs, 'reason'>): SetStatusArgs {
  return {
    ...base,
    reason: reason(body, true),
    tenantId,
    status: oneOf(body, 'status', ['active', 'suspended', 'cancelled'] as const, true)!,
  };
}

export function parseRevoke(body: Body, tenantId: string, base: Omit<BaseArgs, 'reason'>): RevokeArgs {
  const hard = body.hard === true || body.hard === 'true';
  return { ...base, reason: reason(body, true), tenantId, hard };
}

export function parseRevokeAppliance(
  body: Body,
  tenantId: string,
  applianceId: string,
  base: Omit<BaseArgs, 'reason'>,
): RevokeApplianceArgs {
  const id = applianceId.trim();
  if (!id || id.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(id)) throw new ActionValidationError('Invalid appliance id');
  return { ...base, reason: reason(body, true), tenantId, applianceId: id };
}

export function parseBillingPause(body: Body, tenantId: string, base: Omit<BaseArgs, 'reason'>): BillingPauseArgs {
  return {
    ...base,
    reason: reason(body, true),
    tenantId,
    resumesAt: unixFuture(body, 'resumes_at', { required: false }),
    behavior: oneOf(body, 'behavior', ['void', 'keep_as_draft', 'mark_uncollectible'] as const, true)!,
  };
}

export function parseBillingResume(body: Body, tenantId: string, base: Omit<BaseArgs, 'reason'>): BillingResumeArgs {
  return { ...base, reason: reason(body, false), tenantId };
}

export function isTenantId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
