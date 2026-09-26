export function shouldScheduleAutopay(input: {
  invoiceExists: boolean; finalized: boolean; creditNote: boolean; tenantEnabled: boolean; enrolled: boolean;
  chargeableMethod: boolean; providerEnabled: boolean; balanceCents: number; currencySupported: boolean; hasOpenAttempt: boolean;
}): boolean {
  return input.invoiceExists && input.finalized && !input.creditNote && input.tenantEnabled && input.enrolled &&
    input.chargeableMethod && input.providerEnabled && input.balanceCents > 0 && input.currencySupported && !input.hasOpenAttempt;
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
