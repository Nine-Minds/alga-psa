export function shouldScheduleAutopay(input: {
  invoiceExists: boolean; finalized: boolean; creditNote: boolean; tenantEnabled: boolean; enrolled: boolean;
  chargeableMethod: boolean; providerEnabled: boolean; balanceCents: number; currencySupported: boolean; hasOpenAttempt: boolean;
}): boolean {
  return input.invoiceExists && input.finalized && !input.creditNote && input.tenantEnabled && input.enrolled &&
    input.chargeableMethod && input.providerEnabled && input.balanceCents > 0 && input.currencySupported && !input.hasOpenAttempt;
}

export function isMissedFinalizeCandidate(input: {
  status: string; invoiceType?: string | null; finalizedAt?: Date | string | null;
  authorizedAt?: Date | string | null; now?: Date; maxAgeDays?: number;
}): boolean {
  if (input.status !== 'sent' || input.invoiceType === 'credit_note' || !input.finalizedAt || !input.authorizedAt) return false;
  const finalizedAt = new Date(input.finalizedAt).getTime();
  const authorizedAt = new Date(input.authorizedAt).getTime();
  const now = (input.now ?? new Date()).getTime();
  const windowMs = (input.maxAgeDays ?? 7) * 24 * 60 * 60 * 1000;
  return Number.isFinite(finalizedAt) && Number.isFinite(authorizedAt) && finalizedAt >= now - windowMs && finalizedAt <= now && authorizedAt <= finalizedAt;
}

export function isAutopayEnrollmentValid(input: {
  tenantEnabled: boolean; profileMatches: boolean; providerType?: string | null; status?: string | null;
  externalPaymentMethodId?: string | null; externalCustomerId?: string | null;
}): boolean {
  return input.tenantEnabled && input.profileMatches && input.providerType === 'stripe' && input.status === 'active' &&
    !!input.externalPaymentMethodId && !!input.externalCustomerId;
}

/**
 * The consent version a portal user accepted must be the tenant's current one;
 * a stale page (text changed since render) or a forged value is rejected.
 * MSP attestations always record the current version.
 */
export function resolveConsentTextVersion(input: { source: 'client_portal' | 'msp'; submittedVersion?: string | null; currentVersion?: string | null }): string {
  const current = String(input.currentVersion ?? '1');
  if (input.source === 'msp') return current;
  if (String(input.submittedVersion ?? '') !== current) {
    throw new Error('The auto-pay authorization text has changed. Please review it and authorize again.');
  }
  return current;
}

export function classifyAutopayFailure(code?: string, declineCode?: string, attemptNumber = 1, retryCount = 3): { retryable: boolean; hardDecline: boolean } {
  const decline = declineCode ?? code ?? '';
  const hardDecline = ['stolen_card', 'lost_card', 'fraudulent', 'expired_card'].includes(decline) || (decline === 'do_not_honor' && attemptNumber > retryCount);
  const retryable = !hardDecline && decline !== 'authentication_required' && decline !== 'incorrect_number';
  return { retryable, hardDecline };
}

export function retryAt(previousFailureAt: Date, retryDayOffsets: number[], attemptNumber: number): Date | null {
  const days = retryDayOffsets[attemptNumber - 1];
  return days === undefined ? null : new Date(previousFailureAt.getTime() + days * 24 * 60 * 60 * 1000);
}
