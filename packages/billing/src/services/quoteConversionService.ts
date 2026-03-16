import type { Knex } from 'knex';
import type { IContract, IQuote, IQuoteItem } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';
import Contract from '../models/contract';
import Quote from '../models/quote';

export interface QuoteToContractConversionResult {
  quote: IQuote;
  contract: IContract;
}

function mapQuoteItemToContractLineType(item: IQuoteItem): 'Fixed' | 'Hourly' | 'Usage' {
  if (item.billing_method === 'hourly') {
    return 'Hourly';
  }

  if (item.billing_method === 'usage') {
    return 'Usage';
  }

  return 'Fixed';
}

function getContractLineBillingTiming(item: IQuoteItem): 'arrears' | 'advance' {
  return item.billing_method === 'hourly' || item.billing_method === 'usage'
    ? 'arrears'
    : 'advance';
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

  const nowIso = new Date().toISOString();
  await knexOrTrx('contract_lines').insert(
    recurringItems.map((item, index) => {
      const contractLineType = mapQuoteItemToContractLineType(item);

      return {
        tenant,
        contract_line_id: uuidv4(),
        contract_id: contract.contract_id,
        contract_line_name: item.service_name || item.description,
        description: item.description,
        billing_frequency: item.billing_frequency || billingFrequency,
        is_custom: true,
        contract_line_type: contractLineType,
        billing_timing: getContractLineBillingTiming(item),
        display_order: index,
        custom_rate: contractLineType === 'Fixed' ? item.unit_price : null,
        enable_proration: false,
        billing_cycle_alignment: 'start',
        minimum_billable_time: contractLineType === 'Hourly' ? 15 : null,
        round_up_to_nearest: contractLineType === 'Hourly' ? 15 : null,
        is_active: false,
        created_at: nowIso,
        updated_at: nowIso,
      };
    })
  );

  return {
    quote,
    contract,
  };
}
