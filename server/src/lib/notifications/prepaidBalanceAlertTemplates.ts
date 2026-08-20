/**
 * Notification definitions for prepaid balance alerts (task 29.8.20).
 *
 * The subtype/template rows themselves are seeded by the migration from the
 * shared template source of truth; this module centralizes the names and the
 * template context builders the server-side delivery layer uses. Values that
 * are locale/currency formatted (threshold, available, capacity, used) are
 * formatted by the caller before rendering.
 */

export const CREDIT_LOW_BALANCE_TEMPLATE = 'prepaid-credit-low-balance';
export const BUCKET_THRESHOLD_REACHED_TEMPLATE = 'prepaid-bucket-threshold-reached';
export const PREPAID_REPLENISHMENT_TEMPLATE = 'prepaid-replenishment-created';
export const CREDIT_LOW_BALANCE_SUBTYPE = 'prepaid-credit-low-balance';
export const BUCKET_THRESHOLD_REACHED_SUBTYPE = 'prepaid-bucket-threshold-reached';
export const PREPAID_REPLENISHMENT_SUBTYPE = 'prepaid-replenishment-created';

function baseUrl(): string {
  return (process.env.NEXTAUTH_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

/** MSP navigation link for the account manager. */
export function managerAlertLink(clientId: string): string {
  return `${baseUrl()}/msp/clients/${clientId}?tab=billing`;
}

/** Client portal navigation link for the client billing recipient. */
export function clientAlertLink(): string {
  return `${baseUrl()}/client-portal/billing`;
}

export interface CreditAlertTemplateValues {
  currency: string;
  threshold: string;
  available: string;
  link: string;
}

export interface BucketAlertTemplateValues {
  percent: number;
  usedPercent: string;
  capacity: string;
  used: string;
  periodStart: string;
  periodEnd: string;
  link: string;
}

/**
 * Replenishment outcome as the account manager needs to read it, derived from
 * the alert's `replenishment_status`. `pending` and `issued` are the two normal
 * tier outcomes; `failed` means the invoice exists as a draft but automatic
 * issuing did not complete.
 */
export type PrepaidReplenishmentOutcome = 'drafted' | 'issued' | 'failed';

export function replenishmentOutcomeFromStatus(status: string | null): PrepaidReplenishmentOutcome {
  if (status === 'issued') return 'issued';
  if (status === 'failed') return 'failed';
  return 'drafted';
}

/**
 * Sentence fragments the replenishment templates interpolate. Both slots are
 * translated here rather than in the delivery layer: the templates themselves
 * are seeded per language, so an English fragment substituted into a French
 * sentence would render a mixed-language notification.
 *
 * `statusLabel` completes the subject line ("Prepaid replenishment {label}:
 * Client"); `actionPhrase` completes the body sentence ("Invoice INV-1042 for
 * Client {phrase}."), so it carries the verb and any gender agreement with the
 * invoice noun that leads its language's sentence.
 */
const REPLENISHMENT_STATUS_LABELS: Record<string, Record<PrepaidReplenishmentOutcome, string>> = {
  en: { drafted: 'drafted', issued: 'issued', failed: 'needs attention' },
  fr: { drafted: 'en brouillon', issued: 'émise', failed: 'à vérifier' },
  es: { drafted: 'en borrador', issued: 'emitida', failed: 'requiere atención' },
  de: { drafted: 'als Entwurf', issued: 'ausgestellt', failed: 'prüfen' },
  nl: { drafted: 'als concept', issued: 'uitgegeven', failed: 'vereist aandacht' },
  it: { drafted: 'in bozza', issued: 'emessa', failed: 'da verificare' },
  pl: { drafted: 'wersja robocza', issued: 'wystawiona', failed: 'wymaga uwagi' },
  pt: { drafted: 'em rascunho', issued: 'emitida', failed: 'requer atenção' },
};

const REPLENISHMENT_ACTION_PHRASES: Record<string, Record<PrepaidReplenishmentOutcome, string>> = {
  en: {
    drafted: 'was created as a draft',
    issued: 'was issued automatically',
    failed: 'was created as a draft, but automatic issuing failed',
  },
  fr: {
    drafted: 'a été créée en brouillon',
    issued: 'a été émise automatiquement',
    failed: 'a été créée en brouillon, mais l’émission automatique a échoué',
  },
  es: {
    drafted: 'se creó como borrador',
    issued: 'se emitió automáticamente',
    failed: 'se creó como borrador, pero la emisión automática falló',
  },
  de: {
    drafted: 'wurde als Entwurf erstellt',
    issued: 'wurde automatisch ausgestellt',
    failed: 'wurde als Entwurf erstellt, die automatische Ausstellung ist jedoch fehlgeschlagen',
  },
  nl: {
    drafted: 'is als concept aangemaakt',
    issued: 'is automatisch uitgegeven',
    failed: 'is als concept aangemaakt, maar automatisch uitgeven is mislukt',
  },
  it: {
    drafted: 'è stata creata come bozza',
    issued: 'è stata emessa automaticamente',
    failed: 'è stata creata come bozza, ma l’emissione automatica non è riuscita',
  },
  pl: {
    drafted: 'została utworzona jako wersja robocza',
    issued: 'została wystawiona automatycznie',
    failed: 'została utworzona jako wersja robocza, ale automatyczne wystawienie nie powiodło się',
  },
  pt: {
    drafted: 'foi criada como rascunho',
    issued: 'foi emitida automaticamente',
    failed: 'foi criada como rascunho, mas a emissão automática falhou',
  },
};

function replenishmentFragments(
  locale: string,
  outcome: PrepaidReplenishmentOutcome
): { statusLabel: string; actionPhrase: string } {
  const language = (locale || 'en').split('-')[0].toLowerCase();
  const labels = REPLENISHMENT_STATUS_LABELS[language] ?? REPLENISHMENT_STATUS_LABELS.en;
  const phrases = REPLENISHMENT_ACTION_PHRASES[language] ?? REPLENISHMENT_ACTION_PHRASES.en;
  return { statusLabel: labels[outcome], actionPhrase: phrases[outcome] };
}

export interface PrepaidReplenishmentTemplateValues {
  invoiceNumber: string;
  outcome: PrepaidReplenishmentOutcome;
  link: string;
}

export function buildPrepaidReplenishmentContext(
  clientName: string,
  values: PrepaidReplenishmentTemplateValues,
  locale: string,
): Record<string, unknown> {
  return {
    client: { name: clientName },
    replenishment: {
      invoiceNumber: values.invoiceNumber,
      link: values.link,
      ...replenishmentFragments(locale, values.outcome),
    },
  };
}

export function buildInternalPrepaidReplenishmentContext(
  clientName: string,
  values: PrepaidReplenishmentTemplateValues,
  locale: string,
): Record<string, unknown> {
  return {
    clientName,
    invoiceNumber: values.invoiceNumber,
    link: values.link,
    ...replenishmentFragments(locale, values.outcome),
  };
}

/** Handlebars context for the credit email/internal template. */
export function buildCreditAlertContext(clientName: string, values: CreditAlertTemplateValues): Record<string, unknown> {
  return {
    client: { name: clientName },
    alert: {
      currency: values.currency,
      threshold: values.threshold,
      available: values.available,
      link: values.link,
    },
  };
}

/** Handlebars context for the bucket email/internal template. */
export function buildBucketAlertContext(clientName: string, values: BucketAlertTemplateValues): Record<string, unknown> {
  return {
    client: { name: clientName },
    alert: {
      percent: values.percent,
      usedPercent: values.usedPercent,
      capacity: values.capacity,
      used: values.used,
      periodStart: values.periodStart,
      periodEnd: values.periodEnd,
      link: values.link,
    },
  };
}

/**
 * Flat Handlebars context for the INTERNAL notification channel. The internal
 * renderer substitutes only top-level `\w+` keys (no dotted paths), so the
 * resulting keys must match the seeded internal template placeholders exactly
 * ({{clientName}}, {{available}}, {{currency}}, {{threshold}}, {{percent}},
 * {{usedPercent}}, {{capacity}}, {{used}}, {{periodStart}}, {{periodEnd}},
 * {{link}}).
 */
export function buildInternalAlertContext(
  clientName: string,
  values: Record<string, string | number>
): Record<string, unknown> {
  return { clientName, ...values };
}
