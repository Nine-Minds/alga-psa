import type { Knex } from 'knex';
import type { IContract, IQuote, IQuoteItem } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';
import Contract from '../models/contract';
import Quote from '../models/quote';

export interface QuoteToContractConversionResult {
  quote: IQuote;
  contract: IContract;
}

interface ContractLineMapping {
  item: IQuoteItem;
  contractLineId: string;
  contractLineType: 'Fixed' | 'Hourly' | 'Usage';
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
  const contractLineMappings: ContractLineMapping[] = recurringItems.map((item) => ({
    item,
    contractLineId: uuidv4(),
    contractLineType: mapQuoteItemToContractLineType(item),
  }));

  await knexOrTrx('contract_lines').insert(
    contractLineMappings.map(({ item, contractLineId, contractLineType }, index) => ({
      tenant,
      contract_line_id: contractLineId,
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
    }))
  );

  const configRows = contractLineMappings.map(({ item, contractLineId, contractLineType }) => {
    if (!item.service_id) {
      throw new Error('Recurring quote items must be linked to a catalog service before converting to a contract');
    }

    return {
      item,
      contractLineId,
      contractLineType,
      configId: uuidv4(),
      serviceId: item.service_id,
    };
  });

  await knexOrTrx('contract_line_services').insert(
    configRows.map(({ contractLineId, serviceId, item }) => ({
      tenant,
      contract_line_id: contractLineId,
      service_id: serviceId,
      quantity: item.quantity,
      custom_rate: item.unit_price,
      created_at: nowIso,
      updated_at: nowIso,
    }))
  );

  await knexOrTrx('contract_line_service_configuration').insert(
    configRows.map(({ configId, contractLineId, contractLineType, serviceId, item }) => ({
      tenant,
      config_id: configId,
      contract_line_id: contractLineId,
      service_id: serviceId,
      configuration_type: contractLineType,
      custom_rate: item.unit_price,
      quantity: item.quantity,
      created_at: nowIso,
      updated_at: nowIso,
    }))
  );

  const fixedConfigRows = configRows.filter((row) => row.contractLineType === 'Fixed');
  if (fixedConfigRows.length > 0) {
    await knexOrTrx('contract_line_service_fixed_config').insert(
      fixedConfigRows.map(({ configId, item }) => ({
        tenant,
        config_id: configId,
        base_rate: item.unit_price,
        created_at: nowIso,
        updated_at: nowIso,
      }))
    );
  }

  const hourlyConfigRows = configRows.filter((row) => row.contractLineType === 'Hourly');
  if (hourlyConfigRows.length > 0) {
    await knexOrTrx('contract_line_service_hourly_configs').insert(
      hourlyConfigRows.map(({ configId, item }) => ({
        tenant,
        config_id: configId,
        hourly_rate: item.unit_price,
        minimum_billable_time: 15,
        round_up_to_nearest: 15,
        created_at: nowIso,
        updated_at: nowIso,
      }))
    );

    await knexOrTrx('contract_line_service_hourly_config').insert(
      hourlyConfigRows.map(({ configId }) => ({
        tenant,
        config_id: configId,
        minimum_billable_time: 15,
        round_up_to_nearest: 15,
        enable_overtime: false,
        overtime_rate: null,
        overtime_threshold: null,
        enable_after_hours_rate: false,
        after_hours_multiplier: null,
        created_at: nowIso,
        updated_at: nowIso,
      }))
    );
  }

  const usageConfigRows = configRows.filter((row) => row.contractLineType === 'Usage');
  if (usageConfigRows.length > 0) {
    await knexOrTrx('contract_line_service_usage_config').insert(
      usageConfigRows.map(({ configId, item }) => ({
        tenant,
        config_id: configId,
        unit_of_measure: item.unit_of_measure || 'unit',
        enable_tiered_pricing: false,
        minimum_usage: 0,
        base_rate: item.unit_price,
        created_at: nowIso,
        updated_at: nowIso,
      }))
    );
  }

  return {
    quote,
    contract,
  };
}
