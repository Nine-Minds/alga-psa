import type { IQuote } from '@alga-psa/types';
import { buildDocumentFileName } from '@alga-psa/core/fileNames';

/** Build the customer-facing filename for a quote PDF. */
export const getQuotePdfFileName = (
  quote: Pick<IQuote, 'title' | 'quote_number' | 'quote_id'>,
): string => buildDocumentFileName(quote.title, `Quote_${quote.quote_number ?? quote.quote_id}`);
