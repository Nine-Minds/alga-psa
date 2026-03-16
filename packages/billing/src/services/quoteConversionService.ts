import type { Knex } from 'knex';
import type { IContract, IQuote, IQuoteItem } from '@alga-psa/types';
import Contract from '../models/contract';
import Quote from '../models/quote';

export interface QuoteToContractConversionResult {
  quote: IQuote;
  contract: IContract;
}

function getSelectedRecurringItems(items: IQuoteItem[] = []): IQuoteItem[] {
  return items.filter((item) => {
    if (!item.is_recurring || item.is_discount) {
      return false;
    }

    if (item.is_optional && item.is_selected === false) {
      return false;
    }

    return true;
  });
}

export async function convertQuoteToDraftContract(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  quoteId: string
): Promise<QuoteToContractConversionResult> {
  const quote = await Quote.getById(knexOrTrx, tenant, quoteId);

  if (!quote) {
    throw new Error(`Quote ${quoteId} not found in tenant ${tenant}`);
  }

  if (quote.is_template) {
    throw new Error('Quote templates cannot be converted to contracts');
  }

  if (quote.status !== 'accepted') {
    throw new Error('Only accepted quotes can be converted to contracts');
  }

  if (quote.converted_contract_id) {
    const existingContract = await Contract.getById(knexOrTrx, tenant, quote.converted_contract_id);
    if (existingContract) {
      return {
        quote,
        contract: existingContract,
      };
    }
  }

  const recurringItems = getSelectedRecurringItems(quote.quote_items ?? []);
  if (recurringItems.length === 0) {
    throw new Error('Quote does not contain any recurring items selected for contract conversion');
  }

  const billingFrequency = recurringItems[0]?.billing_frequency || 'monthly';

  const contract = await Contract.create(knexOrTrx, tenant, {
    contract_name: quote.title,
    contract_description: quote.description ?? null,
    billing_frequency: billingFrequency,
    currency_code: quote.currency_code,
    is_active: false,
    status: 'draft',
    is_template: false,
    template_metadata: {
      source_quote_id: quote.quote_id,
      source_quote_number: quote.quote_number ?? null,
      conversion_kind: 'quote_to_contract',
    },
  });

  return {
    quote,
    contract,
  };
}
