import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';

// Creates source records only; invoice generation and rendering remain subjects
// of the caller test. The caller owns tenant isolation and cleanup.
export async function createInvoiceTicketSourceFixture(db: Knex, identity: { tenant: string; userId: string }, customize?: (ids: any) => Promise<void>, options: { materializeServicePeriods?: boolean } = {}) {
    const { tenant, userId } = identity;
    const clientId = randomUUID(), contractId = randomUUID(), lineId = randomUUID(), serviceId = randomUUID(), cycleId = randomUUID(), profileId = randomUUID(), usageLineId = randomUUID(), usageServiceId = randomUUID();
    await db.transaction(async (tx) => {
      const baseClient = await tx('clients').where({ tenant }).first();
      await tx('clients').insert({ ...baseClient, client_id: clientId, client_name: `Invoice ticket acceptance ${clientId.slice(0,6)}`, billing_email: 'billing@example.invalid', billing_contact_id: null, invoice_template_id: null, notes_document_id: null, auto_invoice: false, default_currency_code: 'USD', is_tax_exempt: false });
      await tx('client_billing_profiles').insert({ tenant, billing_profile_id: profileId, client_id: clientId, name: 'Default', is_default: true, is_system_managed_default: true, is_active: true, billing_email: 'billing@example.invalid' });
      await tx('client_billing_cycles').insert({ tenant, billing_profile_id: profileId, billing_cycle_id: cycleId, client_id: clientId, billing_cycle: 'monthly', effective_date: '2026-09-01', period_start_date: '2026-09-01', period_end_date: '2026-10-01', is_active: true });
      await tx('contracts').insert({ tenant, contract_id: contractId, contract_name: `Invoice ticket acceptance ${clientId.slice(0,6)}`, billing_frequency: 'monthly', is_active: true, status: 'active', currency_code: 'USD', owner_client_id: clientId });
      await tx('client_contracts').insert({ tenant, client_contract_id: randomUUID(), client_id: clientId, contract_id: contractId, start_date: '2026-07-01', is_active: true });
      await tx('contract_lines').insert({ tenant, contract_line_id: lineId, contract_id: contractId, contract_line_name: 'Ticket acceptance hourly', contract_line_type: 'Hourly', billing_frequency: 'monthly', billing_timing: 'arrears', cadence_owner: 'client', is_active: true, enable_overtime: true, overtime_threshold: 1, overtime_rate: 22500 });
      const baseService = await tx('service_catalog').where({ tenant, billing_method: 'hourly' }).first();
      if (!baseService) throw new Error('Live fixture needs an existing hourly service type');
      await tx('service_catalog').insert({ ...baseService, service_id: serviceId, service_name: `Ticket acceptance hourly ${clientId.slice(0,6)}`, default_rate: 15000, tax_rate_id: null });
      await tx('service_prices').insert({ tenant, price_id: randomUUID(), service_id: serviceId, currency_code: 'USD', rate: 15000 });
      const configId = randomUUID();
      await tx('contract_line_services').insert({ tenant, contract_line_id: lineId, service_id: serviceId, quantity: 1, custom_rate: 15000 });
      await tx('contract_line_service_configuration').insert({ tenant, config_id: configId, contract_line_id: lineId, service_id: serviceId, configuration_type: 'Hourly', custom_rate: 15000, quantity: 1 });
      await tx('contract_line_service_hourly_config').insert({ tenant, config_id: configId, minimum_billable_time: 0, round_up_to_nearest: 0 });
      await tx('contract_lines').insert({ tenant, contract_line_id: usageLineId, contract_id: contractId, contract_line_name: 'Ticket acceptance usage', contract_line_type: 'Usage', billing_frequency: 'monthly', billing_timing: 'arrears', cadence_owner: 'client', is_active: true });
      await tx('service_catalog').insert({ ...baseService, service_id: usageServiceId, service_name: `Ticket acceptance usage ${clientId.slice(0,6)}`, billing_method: 'usage', default_rate: 5000, tax_rate_id: null });
      await tx('service_prices').insert({ tenant, price_id: randomUUID(), service_id: usageServiceId, currency_code: 'USD', rate: 5000 });
      const usageConfigId = randomUUID();
      await tx('contract_line_services').insert({ tenant, contract_line_id: usageLineId, service_id: usageServiceId, quantity: 1, custom_rate: 5000 });
      await tx('contract_line_service_configuration').insert({ tenant, config_id: usageConfigId, contract_line_id: usageLineId, service_id: usageServiceId, configuration_type: 'Usage', custom_rate: 5000, quantity: 1 });
      await tx('contract_line_service_usage_config').insert({ tenant, config_id: usageConfigId, unit_of_measure: 'unit', base_rate: 5000 });
      await tx('usage_tracking').insert({ tenant, usage_id: randomUUID(), service_id: usageServiceId, client_id: clientId, contract_line_id: usageLineId, usage_date: '2026-08-15', quantity: 1, invoiced: false });
      const baseTicket = await tx('tickets').where({ tenant }).first();
      for (let i = 0; i < 2; i++) {
        const ticketId = randomUUID();
        await tx('tickets').insert({ tenant, ticket_id: ticketId, ticket_number: `DRAFT-${clientId.slice(0,6)}-${i}`, title: `Public ticket ${i}`, attributes: { description: `Public work ${i}`, internal_note: 'PRIVATE_SENTINEL' }, client_id: clientId, status_id: baseTicket.status_id, board_id: baseTicket.board_id, priority_id: baseTicket.priority_id, entered_by: userId, entered_at: new Date() });
        for (let j = 0; j < 2; j++) {
          const minutes = i === 0 && j === 0 ? 120 : 60;
          await tx('time_entries').insert({ tenant, entry_id: randomUUID(), user_id: userId, start_time: `2026-08-${15+i}T10:00:00Z`, end_time: `2026-08-${15+i}T${minutes===120?12:11}:00:00Z`, work_timezone: 'UTC', work_date: `2026-08-${15+i}`, work_item_id: ticketId, work_item_type: 'ticket', approval_status: 'APPROVED', service_id: serviceId, contract_line_id: lineId, billable_duration: minutes, invoiced: false, notes: 'PRIVATE_TIME_SENTINEL' });
        }
      }
    });
    // Isolated tax configuration: never changes a shared service or tax region.
    const taxRateId = randomUUID(), regionCode = `DRAFT-${clientId}`;
    await db('tax_regions').insert({ tenant, region_code: regionCode, region_name: 'Acceptance 10%' });
    await db('tax_rates').insert({ tenant, tax_rate_id: taxRateId, region_code: regionCode, tax_percentage: 10, start_date: '2026-01-01', is_active: true });
    await db('client_tax_rates').insert({ tenant, client_id: clientId, tax_rate_id: taxRateId, is_default: true });
    await db('client_tax_settings').insert({ tenant, client_id: clientId, billing_profile_id: profileId, is_reverse_charge_applicable: false });
    await db('service_catalog').where({ tenant }).whereIn('service_id', [serviceId, usageServiceId]).update({ tax_rate_id: taxRateId });
    if (customize) await customize({ tenant, userId, clientId, contractId, lineId, serviceId, cycleId, profileId, usageLineId, usageServiceId, taxRateId, regionCode });
    if (options.materializeServicePeriods !== false) {
      const { syncRecurringServicePeriodsForContractLine } = await import('@alga-psa/billing/actions/recurringServicePeriodSync');
      await db.transaction((tx) => syncRecurringServicePeriodsForContractLine(tx, { tenant, contractLineId: lineId, sourceRunPrefix: 'invoice-ticket-acceptance' }));
      await db.transaction((tx) => syncRecurringServicePeriodsForContractLine(tx, { tenant, contractLineId: usageLineId, sourceRunPrefix: 'invoice-ticket-acceptance' }));
    }
    return { tenant, userId, clientId, contractId, lineId, serviceId, cycleId, profileId, usageLineId, usageServiceId, taxRateId, regionCode };
}

export async function addLongInvoiceSources(db: Knex, ids: any) {
  const { tenant, clientId, lineId, serviceId } = ids;
        const secondService = randomUUID(), secondTax = randomUUID(), configId = randomUUID(), regionCode = `SECOND-${clientId}`;
        const original = await db('service_catalog').where({ tenant, service_id: serviceId }).first();
        await db('tax_regions').insert({ tenant, region_code: regionCode, region_name: 'Acceptance 20%' });
        await db('tax_rates').insert({ tenant, tax_rate_id: secondTax, region_code: regionCode, tax_percentage: 20, start_date: '2026-01-01', is_active: true });
        await db('client_tax_rates').insert({ tenant, client_id: clientId, tax_rate_id: secondTax, is_default: false });
        await db('service_catalog').insert({ ...original, service_id: secondService, service_name: 'Acceptance 20 percent service', tax_rate_id: secondTax });
        await db('service_prices').insert({ tenant, price_id: randomUUID(), service_id: secondService, currency_code: 'USD', rate: 15000 });
        await db('contract_line_services').insert({ tenant, contract_line_id: lineId, service_id: secondService, quantity: 1, custom_rate: 15000 });
        await db('contract_line_service_configuration').insert({ tenant, config_id: configId, contract_line_id: lineId, service_id: secondService, configuration_type: 'Hourly', custom_rate: 15000, quantity: 1 });
        await db('contract_line_service_hourly_config').insert({ tenant, config_id: configId, minimum_billable_time: 0, round_up_to_nearest: 0 });
        const overtime = await db('time_entries').where({ tenant, contract_line_id: lineId, billable_duration: 120 }).first();
        const single = await db('time_entries').where({ tenant, work_item_id: overtime.work_item_id, billable_duration: 60 }).first();
        await db('time_entries').where({ tenant, entry_id: single.entry_id }).update({ service_id: secondService });
        // Source entries, not manufactured renderer rows: a real long invoice.
        for (let i = 0; i < 70; i++) await db('time_entries').insert({ ...single, entry_id: randomUUID(), service_id: i % 2 ? secondService : serviceId, start_time: `2026-08-${String(17 + i % 10).padStart(2, '0')}T10:00:00Z`, end_time: `2026-08-${String(17 + i % 10).padStart(2, '0')}T11:00:00Z`, work_date: `2026-08-${String(17 + i % 10).padStart(2, '0')}` });
        await db('tickets').where({ tenant, client_id: clientId }).update({ title: 'Long public ticket title for nested detail wrapping and invoice readability', attributes: { description: 'Public investigation, remediation and validation across the customer environment. '.repeat(5) } });
}
