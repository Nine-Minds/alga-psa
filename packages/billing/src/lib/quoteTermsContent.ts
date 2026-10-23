// The canonical implementation lives in `@alga-psa/shared` so the workflow
// runtime (crmWorkerDal) and billing share one normalizer without the worker
// importing into billing's package exports. This module keeps billing's
// internal import path stable.
export {
  isEmptyTermsBlock,
  serializeQuoteTermsBlockForDb,
  normalizeQuoteTermsFields,
  prepareQuoteTermsForDb,
} from '@alga-psa/shared/lib/quoteTerms';
