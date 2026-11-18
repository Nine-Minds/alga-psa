/**
 * Pure classifier for the Stripe customer / saved-card import.
 *
 * This is the ONLY place the import rules live. The dry-run preview is this
 * function's output, and the executor applies exactly that output. Nothing in
 * here touches Stripe or the database: callers fetch the Stripe and Alga state
 * and pass it in.
 */

export type ImportRowSource = 'mapping' | 'assisted';

export interface ImportInputRow {
  /** Stable id for the row within one import (used to correlate preview and execute). */
  rowId: string;
  clientId: string;
  billingProfileId: string;
  customerId: string;
  source?: ImportRowSource;
}

export interface StripePaymentMethodSnapshot {
  id: string;
  type: string;
  /** Unix seconds; newest-first ordering picks the default. */
  created: number;
  card?: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
    fingerprint: string | null;
  };
  allowRedisplay?: string | null;
  metadata: Record<string, string>;
  /** True when a succeeded SetupIntent/PaymentIntent proves the card was saved for off-session use. */
  offSessionEvidence: boolean;
}

export interface StripeCustomerSnapshot {
  id: string;
  deleted?: boolean;
  email: string | null;
  name: string | null;
  currency: string | null;
  defaultPaymentMethodId: string | null;
  metadata: Record<string, string>;
  paymentMethods: StripePaymentMethodSnapshot[];
}

export interface AlgaProfileState {
  clientId: string;
  billingProfileId: string;
  clientName: string;
  profileName: string;
  isActive: boolean;
  /** Lower-case ISO currency the profile bills in, or null when not configured. */
  currency: string | null;
}

export interface AlgaPaymentMethodState {
  paymentMethodId: string;
  externalPaymentMethodId: string;
  clientId: string;
  billingProfileId: string;
  isDefault: boolean;
  isDeleted: boolean;
  status: string;
}

export interface AlgaState {
  tenantId: string;
  profiles: AlgaProfileState[];
  mappings: Array<{ clientId: string; billingProfileId: string; customerId: string }>;
  paymentMethods: AlgaPaymentMethodState[];
  enrolledProfileIds: string[];
  /** Upper-case ISO codes the provider can charge. */
  supportedCurrencies: string[];
  now: Date;
}

export type RowAction = 'adopt' | 'already-imported' | 'conflict' | 'skip';
export type CardAction = 'import' | 'already-imported' | 'conflict' | 'skip';

export type RowReason =
  | 'invalid-customer-id'
  | 'customer-not-found'
  | 'customer-deleted'
  | 'profile-not-found'
  | 'profile-inactive'
  | 'currency-not-configured'
  | 'currency-unsupported'
  | 'duplicate-customer-in-input'
  | 'duplicate-profile-in-input'
  | 'customer-claimed-by-other'
  | 'customer-metadata-owned-by-other'
  | 'profile-mapped-to-other-customer';

export type CardReason = 'unsupported-method' | 'expired-card' | 'card-claimed-elsewhere';

export type RowWarning = 'no-cards' | 'customer-currency-mismatch' | 'no-importable-card';

export interface CardPlan {
  externalPaymentMethodId: string;
  action: CardAction;
  reason?: CardReason;
  type: string;
  brand: string | null;
  last4: string | null;
  expMonth: string | null;
  expYear: string | null;
  fingerprint: string | null;
  /** The importable card that will become (or already is) the profile default via this import. */
  setAsDefault: boolean;
  /** Imported, but nothing proves it was saved for off-session use: expect SCA challenges. */
  scaRisk: boolean;
  allowRedisplay: string | null;
  needsMetadataStamp: boolean;
}

export interface RowPlan {
  rowId: string;
  clientId: string;
  billingProfileId: string;
  customerId: string;
  source: ImportRowSource;
  action: RowAction;
  reason?: RowReason;
  warnings: RowWarning[];
  currency: string | null;
  customerEmail: string | null;
  customerName: string | null;
  /** Alga names for the review table; null when the client/profile did not resolve. */
  clientName: string | null;
  profileName: string | null;
  /** Step 1 of adoption: Stripe customer metadata still needs stamping. */
  needsCustomerStamp: boolean;
  /** Step 2 of adoption: client_payment_customers row still needs writing. */
  needsMapping: boolean;
  cards: CardPlan[];
  /** Stripe pm_ id of the card enrollment would use (new default, or the profile's existing usable default). */
  enrollmentExternalPaymentMethodId: string | null;
  alreadyEnrolled: boolean;
  /** An operator may attest and enroll this row. */
  enrollable: boolean;
}

export interface ImportPlan {
  rows: RowPlan[];
}

const CUSTOMER_ID = /^cus_[A-Za-z0-9]+$/;

export function importMetadata(tenantId: string, clientId: string, billingProfileId: string): Record<string, string> {
  return { tenant_id: tenantId, client_id: clientId, billing_profile_id: billingProfileId, source: 'alga_import' };
}

/** Metadata that `getOrCreateCustomer` requires to reuse a customer (source is informational only). */
function metadataMatches(metadata: Record<string, string>, tenantId: string, clientId: string, billingProfileId: string): boolean {
  return metadata.tenant_id === tenantId && metadata.client_id === clientId && metadata.billing_profile_id === billingProfileId;
}

function metadataClaimedByOther(metadata: Record<string, string>, tenantId: string, clientId: string, billingProfileId: string): boolean {
  const any = metadata.tenant_id || metadata.client_id || metadata.billing_profile_id;
  return !!any && !metadataMatches(metadata, tenantId, clientId, billingProfileId) &&
    // A customer with only partially stamped metadata that doesn't contradict us is adoptable.
    ((!!metadata.tenant_id && metadata.tenant_id !== tenantId) ||
      (!!metadata.client_id && metadata.client_id !== clientId) ||
      (!!metadata.billing_profile_id && metadata.billing_profile_id !== billingProfileId));
}

function isExpired(card: { expMonth: number; expYear: number }, now: Date): boolean {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return card.expYear < year || (card.expYear === year && card.expMonth < month);
}

function emptyRow(row: ImportInputRow, partial: Partial<RowPlan>): RowPlan {
  return {
    rowId: row.rowId, clientId: row.clientId, billingProfileId: row.billingProfileId, customerId: row.customerId,
    source: row.source ?? 'mapping', action: 'skip', warnings: [], currency: null, customerEmail: null, customerName: null, clientName: null, profileName: null,
    needsCustomerStamp: false, needsMapping: false, cards: [], enrollmentExternalPaymentMethodId: null,
    alreadyEnrolled: false, enrollable: false, ...partial,
  };
}

export function classifyImport(input: {
  rows: ImportInputRow[];
  customers: StripeCustomerSnapshot[];
  alga: AlgaState;
}): ImportPlan {
  const { alga } = input;
  const customersById = new Map(input.customers.map((customer) => [customer.id, customer]));
  const profileKey = (clientId: string, profileId: string) => `${clientId}:${profileId}`;
  const profiles = new Map(alga.profiles.map((profile) => [profileKey(profile.clientId, profile.billingProfileId), profile]));

  const rowsByCustomer = new Map<string, number>();
  const rowsByProfile = new Map<string, Set<string>>();
  for (const row of input.rows) {
    rowsByCustomer.set(row.customerId, (rowsByCustomer.get(row.customerId) ?? 0) + 1);
    const key = profileKey(row.clientId, row.billingProfileId);
    const set = rowsByProfile.get(key) ?? new Set<string>();
    set.add(row.customerId);
    rowsByProfile.set(key, set);
  }

  const rows = input.rows.map((row): Omit<RowPlan, 'clientName' | 'profileName'> => {
    if (!CUSTOMER_ID.test(row.customerId)) return emptyRow(row, { action: 'skip', reason: 'invalid-customer-id' });

    const profile = profiles.get(profileKey(row.clientId, row.billingProfileId));
    if (!profile) return emptyRow(row, { action: 'skip', reason: 'profile-not-found' });
    if (!profile.isActive) return emptyRow(row, { action: 'skip', reason: 'profile-inactive' });

    // One cus_ maps to exactly one (client, profile): the schema has no unique index to enforce it.
    if ((rowsByCustomer.get(row.customerId) ?? 0) > 1) {
      return emptyRow(row, { action: 'conflict', reason: 'duplicate-customer-in-input', currency: profile.currency });
    }
    if ((rowsByProfile.get(profileKey(row.clientId, row.billingProfileId))?.size ?? 0) > 1) {
      return emptyRow(row, { action: 'conflict', reason: 'duplicate-profile-in-input', currency: profile.currency });
    }

    const customer = customersById.get(row.customerId);
    if (!customer) return emptyRow(row, { action: 'skip', reason: 'customer-not-found', currency: profile.currency });
    if (customer.deleted) return emptyRow(row, { action: 'skip', reason: 'customer-deleted', currency: profile.currency });

    const base = { currency: profile.currency, customerEmail: customer.email, customerName: customer.name };

    if (!profile.currency) return emptyRow(row, { ...base, action: 'skip', reason: 'currency-not-configured' });
    if (!alga.supportedCurrencies.includes(profile.currency.toUpperCase())) {
      return emptyRow(row, { ...base, action: 'skip', reason: 'currency-unsupported' });
    }

    const claimedBy = alga.mappings.find((mapping) => mapping.customerId === row.customerId &&
      (mapping.clientId !== row.clientId || mapping.billingProfileId !== row.billingProfileId));
    if (claimedBy) return emptyRow(row, { ...base, action: 'conflict', reason: 'customer-claimed-by-other' });

    if (metadataClaimedByOther(customer.metadata, alga.tenantId, row.clientId, row.billingProfileId)) {
      return emptyRow(row, { ...base, action: 'conflict', reason: 'customer-metadata-owned-by-other' });
    }

    const profileMapping = alga.mappings.find((mapping) => mapping.clientId === row.clientId && mapping.billingProfileId === row.billingProfileId);
    if (profileMapping && profileMapping.customerId !== row.customerId) {
      return emptyRow(row, { ...base, action: 'conflict', reason: 'profile-mapped-to-other-customer' });
    }

    const warnings: RowWarning[] = [];
    if (customer.currency && customer.currency.toLowerCase() !== profile.currency.toLowerCase()) warnings.push('customer-currency-mismatch');

    // --- cards -------------------------------------------------------------
    const profileMethods = alga.paymentMethods.filter((method) => method.billingProfileId === row.billingProfileId &&
      method.clientId === row.clientId && !method.isDeleted);
    const existingDefault = profileMethods.find((method) => method.isDefault);
    const methodByExternal = new Map(alga.paymentMethods.map((method) => [method.externalPaymentMethodId, method]));

    const cards: CardPlan[] = [];
    const importable: StripePaymentMethodSnapshot[] = [];
    const sorted = [...customer.paymentMethods].sort((a, b) => b.created - a.created || a.id.localeCompare(b.id));
    for (const method of sorted) {
      const stamped = metadataMatches(method.metadata, alga.tenantId, row.clientId, row.billingProfileId);
      const common = {
        externalPaymentMethodId: method.id, type: method.type,
        brand: method.card?.brand ?? null, last4: method.card?.last4 ?? null,
        expMonth: method.card ? String(method.card.expMonth) : null, expYear: method.card ? String(method.card.expYear) : null,
        fingerprint: method.card?.fingerprint ?? null, setAsDefault: false, scaRisk: false,
        allowRedisplay: method.allowRedisplay ?? null, needsMetadataStamp: false,
      };
      if (method.type !== 'card' || !method.card) {
        cards.push({ ...common, action: 'skip', reason: 'unsupported-method' });
        continue;
      }
      const existing = methodByExternal.get(method.id);
      if (existing && !existing.isDeleted && (existing.clientId !== row.clientId || existing.billingProfileId !== row.billingProfileId)) {
        cards.push({ ...common, action: 'conflict', reason: 'card-claimed-elsewhere' });
        continue;
      }
      // A card the SCA fallback parked in requires_update stays parked: a re-run must not re-activate it.
      if (existing && !existing.isDeleted) {
        cards.push({ ...common, action: 'already-imported', needsMetadataStamp: !stamped, scaRisk: !method.offSessionEvidence });
        continue;
      }
      if (isExpired(method.card, alga.now)) {
        cards.push({ ...common, action: 'skip', reason: 'expired-card' });
        continue;
      }
      importable.push(method);
      cards.push({ ...common, action: 'import', needsMetadataStamp: !stamped, scaRisk: !method.offSessionEvidence });
    }

    // Default selection: never displace an existing default. Otherwise prefer the
    // customer's own invoice default, then the newest card.
    let defaultExternalId: string | null = null;
    if (!existingDefault) {
      const candidates = cards.filter((card) => card.action === 'import' || card.action === 'already-imported');
      const preferred = candidates.find((card) => card.externalPaymentMethodId === customer.defaultPaymentMethodId) ?? candidates[0];
      if (preferred) {
        defaultExternalId = preferred.externalPaymentMethodId;
        preferred.setAsDefault = true;
      }
    }

    const existingDefaultUsable = existingDefault
      ? alga.paymentMethods.find((method) => method.paymentMethodId === existingDefault.paymentMethodId && method.status === 'active')
      : undefined;
    const enrollmentExternalPaymentMethodId = defaultExternalId ?? existingDefaultUsable?.externalPaymentMethodId ?? null;

    if (customer.paymentMethods.length === 0) warnings.push('no-cards');
    else if (cards.every((card) => card.action === 'skip' || card.action === 'conflict')) warnings.push('no-importable-card');

    const needsCustomerStamp = !metadataMatches(customer.metadata, alga.tenantId, row.clientId, row.billingProfileId);
    const needsMapping = !profileMapping;
    const pendingCards = cards.some((card) => card.action === 'import' || (card.action === 'already-imported' && card.needsMetadataStamp));
    const pending = needsCustomerStamp || needsMapping || pendingCards || defaultExternalId !== null;
    const alreadyEnrolled = alga.enrolledProfileIds.includes(row.billingProfileId);

    return {
      rowId: row.rowId, clientId: row.clientId, billingProfileId: row.billingProfileId, customerId: row.customerId,
      source: row.source ?? 'mapping', action: pending ? 'adopt' : 'already-imported', warnings, ...base,
      needsCustomerStamp, needsMapping, cards, enrollmentExternalPaymentMethodId, alreadyEnrolled,
      enrollable: !alreadyEnrolled && enrollmentExternalPaymentMethodId !== null,
    };
  });

  // Names are display-only; attach after the rules ran so no rule depends on them.
  return {
    rows: rows.map((row) => {
      const profile = profiles.get(profileKey(row.clientId, row.billingProfileId));
      return { ...row, clientName: profile?.clientName ?? null, profileName: profile?.profileName ?? null };
    }),
  };
}

// ---------------------------------------------------------------------------
// Assisted matching
// ---------------------------------------------------------------------------

export interface MatchProposal {
  customerId: string;
  clientId: string;
  billingProfileId: string;
  matchedBy: 'email' | 'name';
  customerEmail: string | null;
  customerName: string | null;
}

export interface MatchAmbiguity {
  customerId: string;
  matchedBy: 'email' | 'name';
  reason: 'multiple-profiles' | 'multiple-customers';
}

export interface MatchCandidate {
  clientId: string;
  billingProfileId: string;
  clientName: string;
  profileName: string;
  /** Billing recipient email, if the client has one. */
  email: string | null;
  /** True when the profile already has a customer mapping; it is not proposed again. */
  mapped: boolean;
  /** Active profiles the client has; email/client-name matches only resolve when there is exactly one. */
  clientActiveProfileCount: number;
}

const normalizeName = (value: string | null | undefined) =>
  (value ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Proposes customer -> (client, profile) pairs, by exact email first, then by
 * normalised name. Ambiguous matches are reported, never guessed. Proposals are
 * input to the review step only; they go through classifyImport like any other row.
 */
export function proposeCustomerMatches(input: {
  customers: StripeCustomerSnapshot[];
  candidates: MatchCandidate[];
  /** cus_ ids already mapped in Alga or already present in explicit rows. */
  excludedCustomerIds?: string[];
}): { proposals: MatchProposal[]; ambiguous: MatchAmbiguity[] } {
  const excluded = new Set(input.excludedCustomerIds ?? []);
  const open = input.candidates.filter((candidate) => !candidate.mapped);
  const proposals: MatchProposal[] = [];
  const ambiguous: MatchAmbiguity[] = [];

  const raw: Array<MatchProposal | MatchAmbiguity> = [];
  for (const customer of input.customers) {
    if (customer.deleted || excluded.has(customer.id)) continue;
    const email = customer.email?.trim().toLowerCase();
    const name = normalizeName(customer.name);

    const byEmail = email ? open.filter((candidate) => candidate.email?.trim().toLowerCase() === email) : [];
    const byName = name ? open.filter((candidate) => normalizeName(candidate.clientName) === name || normalizeName(candidate.profileName) === name) : [];

    const pick = (matches: MatchCandidate[], matchedBy: 'email' | 'name'): boolean => {
      if (matches.length === 0) return false;
      const clients = new Set(matches.map((candidate) => candidate.clientId));
      if (matches.length > 1) {
        raw.push({ customerId: customer.id, matchedBy, reason: clients.size === 1 ? 'multiple-profiles' : 'multiple-customers' });
        return true;
      }
      const match = matches[0];
      if (match.clientActiveProfileCount > 1 && matchedBy === 'email') {
        raw.push({ customerId: customer.id, matchedBy, reason: 'multiple-profiles' });
        return true;
      }
      raw.push({ customerId: customer.id, clientId: match.clientId, billingProfileId: match.billingProfileId, matchedBy,
        customerEmail: customer.email, customerName: customer.name });
      return true;
    };
    if (!pick(byEmail, 'email')) pick(byName, 'name');
  }

  // A profile claimed by several customers is ambiguous for all of them.
  const perProfile = new Map<string, number>();
  for (const item of raw) {
    if ('billingProfileId' in item) perProfile.set(item.billingProfileId, (perProfile.get(item.billingProfileId) ?? 0) + 1);
  }
  for (const item of raw) {
    if ('billingProfileId' in item) {
      if ((perProfile.get(item.billingProfileId) ?? 0) > 1) ambiguous.push({ customerId: item.customerId, matchedBy: item.matchedBy, reason: 'multiple-customers' });
      else proposals.push(item);
    } else {
      ambiguous.push(item);
    }
  }
  return { proposals, ambiguous };
}
