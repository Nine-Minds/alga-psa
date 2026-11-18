/**
 * The recurring-member rate rules live in `@alga-psa/shared` because the
 * stored-contract valuation (shared/billingClients/contractMonthlyValue) must
 * use them too and shared cannot import from this package. The pure module has
 * no DB access, so the client-side contract wizard imports it as well.
 */
export {
  resolveRecurringMemberRate,
  hasRecurringMemberRate,
  resolveEffectiveLineRate,
  resolveFixedLineRecurringTotal,
  resolveFixedLinePeriodTotal,
  productMembersRecurringTotalCents,
  normalizeToMonthlyCents,
  summarizeRecurringAmounts,
} from '@alga-psa/shared/billingClients/recurringMemberRate';
export type {
  RecurringPeriodAmount,
  RecurringFrequencyGroup,
  RecurringSummary,
  RecurringMemberRateInput,
  ResolvedRecurringMemberRate,
  RecurringMemberRateSource,
  FixedLineInput,
  FixedLineMemberInput,
} from '@alga-psa/shared/billingClients/recurringMemberRate';
