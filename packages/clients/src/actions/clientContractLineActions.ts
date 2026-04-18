'use server'

import { withTransaction } from '@alga-psa/db';
import { createTenantKnex } from '@alga-psa/db';
import { Knex } from 'knex';
import type { IClientContractLine } from '@alga-psa/types';
import { Temporal } from '@js-temporal/polyfill';
import { toPlainDate, toISODate } from '@alga-psa/core';
import { normalizeLiveRecurringStorage } from '@alga-psa/shared/billingClients/recurrenceStorageModel';
import { resolveCadenceOwner } from '@alga-psa/shared/billingClients/recurringTiming';
import { cloneTemplateContractLineAsync } from '../lib/billingHelpers';
import { withAuth } from '@alga-psa/auth';

const parseClientContractLineIdentity = (value: string): { clientContractId?: string; contractLineId: string } => {
  const match = value.match(/^contract-([0-9a-fA-F-]{36})-([0-9a-fA-F-]{36})$/);
  if (!match) {
    return { contractLineId: value };
  }
  return {
    clientContractId: match[1],
    contractLineId: match[2],
  };
};

const ensureAssignmentScopedIdentity = (
  identity: { clientContractId?: string; contractLineId: string },
): { clientContractId: string; contractLineId: string } => {
  if (!identity.clientContractId) {
    throw new Error('Assignment-scoped client contract line identity is required for this mutation.');
  }
  return {
    clientContractId: identity.clientContractId,
    contractLineId: identity.contractLineId,
  };
};

const assertSharedHeaderMutationIsExplicit = async (
  trx: Knex.Transaction,
  tenant: string,
  identity: { clientContractId: string; contractLineId: string },
): Promise<void> => {
  const selectedAssignment = await trx('client_contracts')
    .where({ tenant, client_contract_id: identity.clientContractId })
    .first('client_id', 'contract_id');
  if (!selectedAssignment) {
    throw new Error(`Client contract ${identity.clientContractId} not found.`);
  }

  const assignmentCountRow = await trx('client_contracts')
    .where({
      tenant,
      client_id: selectedAssignment.client_id,
      contract_id: selectedAssignment.contract_id,
      is_active: true,
    })
    .count<{ count: string }[]>('* as count')
    .first();
  const assignmentCount = Number(assignmentCountRow?.count ?? 0);
  if (assignmentCount > 1) {
    throw new Error(
      `Contract line mutation is ambiguous for assignment ${identity.clientContractId}. ` +
      'This mutation path updates shared contract-header lines. Resolve by editing a contract assignment with unique line scope.'
    );
  }

  const lineExists = await trx('contract_lines as cl')
    .where({
      'cl.tenant': tenant,
      'cl.contract_line_id': identity.contractLineId,
      'cl.contract_id': selectedAssignment.contract_id,
    })
    .first('cl.contract_line_id');
  if (!lineExists) {
    throw new Error(
      `Contract line ${identity.contractLineId} is not associated with client contract ${identity.clientContractId}.`
    );
  }
};

// Historical flat invoices can still lack canonical recurring detail rows during rollout.
// Mutation guards therefore prefer recurring detail periods and fall back only for old flat invoices.
async function getLatestHistoricalInvoicedEndDate(db: any, tenant: string, clientContractLineId: string): Promise<Date | null> {
  const identity = parseClientContractLineIdentity(clientContractLineId);

  // First, get the client_contract_id associated with the clientContractLineId
  const planInfoQuery = db('contract_lines as cl')
    .join('client_contracts as cc', function(this: Knex.JoinClause) {
      this.on('cl.contract_id', '=', 'cc.contract_id')
          .andOn('cl.tenant', '=', 'cc.tenant');
    })
    .select('cc.client_id', 'cl.contract_line_id', 'cc.client_contract_id')
    .where({ 'cl.contract_line_id': identity.contractLineId, 'cl.tenant': tenant });

  if (identity.clientContractId) {
    planInfoQuery.andWhere('cc.client_contract_id', identity.clientContractId);
  }
  const planInfo = await planInfoQuery.first();

  if (!planInfo) {
    console.warn(`Contract line ${clientContractLineId} not found for tenant ${tenant}`);
    return null; // No contract line assignment found
  }

  const { client_id, contract_line_id, client_contract_id } = planInfo;

  // Check for invoices with items linked to this specific client_contract via client_contract_id
  // This ensures we only check invoices generated from THIS specific contract assignment
  const latestInvoice = await db('invoices as i')
    .join('invoice_charges as ii', function(this: Knex.JoinClause) {
      this.on('i.invoice_id', '=', 'ii.invoice_id')
          .andOn('i.tenant', '=', 'ii.tenant');
    })
    .join('client_contracts as cc', function(this: Knex.JoinClause) {
      this.on('ii.client_contract_id', '=', 'cc.client_contract_id')
          .andOn('ii.tenant', '=', 'cc.tenant');
    })
    .where({
      'cc.client_contract_id': client_contract_id,
      'cc.tenant': tenant
    })
    .orderBy('i.invoice_date', 'desc')
    .select('i.billing_period_end', 'i.invoice_date')
    .first();

  // If we found an invoice, determine the appropriate date to return
  if (latestInvoice) {
    // NOTE: `billing_period_end` is the INVOICE WINDOW end (when the cycle could be cut),
    // not the service period end. For arrears billing this over-reports "billed through" by
    // roughly one cycle. Acceptable here only because this is the legacy-flat-invoice fallback;
    // the canonical path reads `recurring_service_periods`. Column rename to `invoice_window_*` is pending.
    if (latestInvoice.billing_period_end) {
      return new Date(latestInvoice.billing_period_end);
    }
    // Otherwise, fall back to invoice_date
    else if (latestInvoice.invoice_date) {
      console.log(`Using invoice_date as fallback for plan ${contract_line_id} since billing_period_end is null`);
      return new Date(latestInvoice.invoice_date);
    }
  }

  // If no invoices found or no usable dates, return null
  return null;
}

async function getLatestAuthoritativeRecurringPeriodEndDate(
  db: any,
  tenant: string,
  clientContractLineId: string,
): Promise<Temporal.PlainDate | null> {
  const canonicalDetail = await db('invoice_charge_details as iid')
    .join('contract_line_service_configuration as clsc', function(this: Knex.JoinClause) {
      this.on('iid.config_id', '=', 'clsc.config_id')
        .andOn('iid.tenant', '=', 'clsc.tenant');
    })
    .where('iid.tenant', tenant)
    .andWhere('clsc.contract_line_id', clientContractLineId)
    .whereNotNull('iid.service_period_end')
    .orderBy('iid.service_period_end', 'desc')
    .first('iid.service_period_end');

  if (canonicalDetail?.service_period_end) {
    return toPlainDate(canonicalDetail.service_period_end);
  }

  const historicalInvoiceEndDate = await getLatestHistoricalInvoicedEndDate(db, tenant, clientContractLineId);
  return historicalInvoiceEndDate ? toPlainDate(historicalInvoiceEndDate) : null;
}

function assertContractLineMutationAllowed(
  latestInvoicedPeriodEnd: Temporal.PlainDate | null,
  clientContractLineId: string,
  updates: Partial<IClientContractLine>,
): void {
  if (!latestInvoicedPeriodEnd) {
    return;
  }

  const proposedReplacementLineId = updates.contract_line_id?.trim();
  if (
    proposedReplacementLineId &&
    proposedReplacementLineId.length > 0 &&
    proposedReplacementLineId !== clientContractLineId
  ) {
    throw new Error(
      `Cannot replace contract line assignment after it has authoritative recurring detail periods through ${latestInvoicedPeriodEnd.toString()}. End the current line and add a new contract line instead.`
    );
  }

  const proposedEndDate = updates.end_date ? toPlainDate(new Date(updates.end_date)) : null;
  const today = toPlainDate(new Date());

  if (
    updates.is_active === false &&
    !proposedEndDate &&
    Temporal.PlainDate.compare(today, latestInvoicedPeriodEnd) < 0
  ) {
    throw new Error(
      `Cannot deactivate contract line assignment before ${latestInvoicedPeriodEnd.toString()} as it has been invoiced through that date.`
    );
  }

  if (
    proposedEndDate &&
    Temporal.PlainDate.compare(proposedEndDate, latestInvoicedPeriodEnd) < 0
  ) {
    throw new Error(
      `Cannot set end date to ${proposedEndDate.toString()} as the contract line has been invoiced through ${latestInvoicedPeriodEnd.toString()}. The earliest end date allowed is ${latestInvoicedPeriodEnd.toString()}.`
    );
  }
}

async function getExistingCadenceOwner(
  trx: Knex.Transaction,
  tenant: string,
  clientContractLineId: string,
): Promise<IClientContractLine['cadence_owner']> {
  const existingLine = await trx('contract_lines')
    .where({
      contract_line_id: clientContractLineId,
      tenant,
    })
    .first('cadence_owner');

  return resolveCadenceOwner(existingLine?.cadence_owner);
}


export const getClientContractLine = withAuth(async (
  _user,
  { tenant },
  clientId: string,
  clientContractId?: string
): Promise<IClientContractLine[]> => {
  try {
    const { knex: db } = await createTenantKnex();
    const clientContractLine: IClientContractLine[] = await withTransaction(db, async (trx: Knex.Transaction) => {
      const query = trx('contract_lines as cl')
        .join('client_contracts as cc', function () {
          this.on('cc.contract_id', '=', 'cl.contract_id')
            .andOn('cc.tenant', '=', 'cl.tenant');
        })
        .join('contracts as co', function () {
          this.on('co.contract_id', '=', 'cl.contract_id')
            .andOn('co.tenant', '=', 'cl.tenant');
        })
        .leftJoin('service_categories as sc', function () {
          this.on('sc.category_id', '=', 'cl.service_category')
            .andOn('sc.tenant', '=', 'cl.tenant');
        })
        .where({
          'cc.client_id': clientId,
          'cl.is_active': true,
          'cl.tenant': tenant
        })
        .select([
          'cl.*',
          trx.raw("concat('contract-', cc.client_contract_id, '-', cl.contract_line_id) as client_contract_line_id"),
          'cc.client_id',
          'cc.client_contract_id',
          'cc.start_date',
          'cc.end_date',
          'cc.template_contract_id',
          'co.contract_name',
          'sc.category_name as service_category_name'
        ])
        .orderBy('cc.start_date', 'desc');

      if (clientContractId) {
        query.andWhere('cc.client_contract_id', clientContractId);
      }

      return await query as unknown as IClientContractLine[];
    });

    return clientContractLine.map((billing: IClientContractLine): IClientContractLine => {
      const recurringStorage = normalizeLiveRecurringStorage(billing);
      return {
        ...recurringStorage,
        // Provenance-only metadata: never used as live runtime lookup identity.
        template_contract_id: billing.template_contract_id ?? null,
        // Convert dates to ISO8601String as expected by the interface
        // Convert dates to ISO8601String: DB -> PlainDate -> ISOString
        start_date: toISODate(toPlainDate(billing.start_date)),
        end_date: billing.end_date ? toISODate(toPlainDate(billing.end_date)) : null,
      };
    });
  } catch (error) {
    console.error('Error fetching client contract line:', error);
    throw new Error('Failed to fetch client contract line');
  }
});

export const updateClientContractLine = withAuth(async (
  _user,
  { tenant },
  clientContractLineId: string,
  updates: Partial<IClientContractLine>
): Promise<void> => {
  try {
    const { knex: db } = await createTenantKnex();
    const identity = ensureAssignmentScopedIdentity(parseClientContractLineIdentity(clientContractLineId));
    const latestInvoicedPeriodEnd = await getLatestAuthoritativeRecurringPeriodEndDate(db, tenant, clientContractLineId);
    assertContractLineMutationAllowed(latestInvoicedPeriodEnd, identity.contractLineId, updates);
    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      await assertSharedHeaderMutationIsExplicit(trx, tenant, identity);
      const cadenceOwner = updates.cadence_owner ?? await getExistingCadenceOwner(trx, tenant, identity.contractLineId);

      // Filter updates to include only columns that exist on contract_lines
      const {
        client_contract_line_id,
        client_id,
        start_date,
        end_date,
        client_contract_id,
        template_contract_id,
        contract_name,
        service_category_name,
        ...validUpdates
      } = updates as any;

      validUpdates.cadence_owner = cadenceOwner;

      return await trx('contract_lines')
        .where({
          contract_line_id: identity.contractLineId,
          tenant
        })
        .update(validUpdates);
    });

    if (result === 0) {
      throw new Error('Contract Line not found or no changes were made');
    }
  } catch (error) {
    console.error('Error updating client contract line:', error);
    throw new Error('Failed to update client contract line');
  }
});

export const addClientContractLine = withAuth(async (
  _user,
  { tenant },
  newBilling: Omit<IClientContractLine, 'client_contract_line_id' | 'tenant'>
): Promise<void> => {
  try {
    const { knex: db } = await createTenantKnex();

    await withTransaction(db, async (trx: Knex.Transaction) => {
      // Get the client contract to find the target contract_id
      if (!newBilling.client_contract_id) {
        throw new Error('client_contract_id is required');
      }

      const clientContract = await trx('client_contracts')
        .where({ tenant, client_contract_id: newBilling.client_contract_id })
        .first('template_contract_id', 'contract_id');

      if (!clientContract?.contract_id) {
        throw new Error('Client contract not found or missing contract_id');
      }

      const templateContractId = clientContract.template_contract_id ?? null;
      if (!templateContractId) {
        throw new Error(
          `Client contract ${newBilling.client_contract_id} is missing template provenance (template_contract_id) required to clone template contract lines`
        );
      }

      // Get the template line to copy
      const templateLine = await trx('contract_lines')
        .where({ tenant, contract_line_id: newBilling.contract_line_id })
        .first();

      if (!templateLine) {
        throw new Error(`Template contract line ${newBilling.contract_line_id} not found`);
      }
      const templateRecurringStorage = normalizeLiveRecurringStorage(templateLine);

      // Check if this contract already has a line from the same template
      const existingLine = await trx('contract_lines')
        .where({
          tenant,
          contract_id: clientContract.contract_id,
          is_active: true
        })
        .whereRaw('contract_line_name = ?', [templateLine.contract_line_name])
        .first();

      if (existingLine) {
        throw new Error('A contract line with the same details already exists for this client');
      }

      // Replacements must create a fresh line identity so historical recurring detail
      // periods remain attached to the superseded line instead of being mutated in place.
      const newContractLineId = trx.raw('gen_random_uuid()');
      const startDate = newBilling.start_date ? new Date(newBilling.start_date) : new Date();

      const [created] = await trx('contract_lines')
        .insert({
          contract_line_id: newContractLineId,
          tenant,
          contract_id: clientContract.contract_id,
          contract_line_name: templateLine.contract_line_name,
          description: templateLine.description,
          billing_frequency: templateLine.billing_frequency,
          contract_line_type: templateLine.contract_line_type,
          service_category: newBilling.service_category ?? templateLine.service_category,
          billing_timing: templateRecurringStorage.billing_timing,
          cadence_owner: newBilling.cadence_owner ?? templateRecurringStorage.cadence_owner,
          is_active: newBilling.is_active ?? true,
          is_custom: false,
          custom_rate: newBilling.custom_rate ?? templateLine.custom_rate,
          display_order: templateLine.display_order ?? 0,
          enable_proration: templateLine.enable_proration,
          enable_overtime: templateLine.enable_overtime,
          overtime_rate: templateLine.overtime_rate,
          overtime_threshold: templateLine.overtime_threshold,
          enable_after_hours_rate: templateLine.enable_after_hours_rate,
          after_hours_multiplier: templateLine.after_hours_multiplier,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now()
        })
        .returning('contract_line_id');

      await cloneTemplateContractLineAsync(trx, {
        tenant,
        templateContractLineId: newBilling.contract_line_id,
        contractLineId: created.contract_line_id,
        templateContractId,
        overrideRate: newBilling.custom_rate ?? null,
        effectiveDate: startDate.toISOString()
      });

      return created;
    });
  } catch (error: any) {
    console.error('Error adding client contract line:', error);
    if (error.code === 'ER_NO_SUCH_TABLE') {
      throw new Error('Database table not found');
    } else if (error.code === 'ER_BAD_FIELD_ERROR') {
      throw new Error('Invalid database field');
    } else {
      throw new Error(error.message || 'Failed to add client contract line');
    }
  }
});

export const removeClientContractLine = withAuth(async (
  _user,
  { tenant },
  clientContractLineId: string
): Promise<void> => {
  try {
    const { knex: db } = await createTenantKnex();
    const identity = ensureAssignmentScopedIdentity(parseClientContractLineIdentity(clientContractLineId));

    // --- Validation Start ---
    const latestInvoicedPeriodEnd = await getLatestAuthoritativeRecurringPeriodEndDate(db, tenant, clientContractLineId);
    assertContractLineMutationAllowed(latestInvoicedPeriodEnd, clientContractLineId, {
      is_active: false,
    });
    // --- Validation End ---

    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      await assertSharedHeaderMutationIsExplicit(trx, tenant, identity);
      return await trx('contract_lines')
        .where({
          contract_line_id: identity.contractLineId,
          tenant
        })
        .update({ is_active: false }); // end_date removed as it's not on contract_lines
    });

    if (result === 0) {
      throw new Error('Contract Line not found or already inactive');
    }
  } catch (error: any) {
    console.error('Error removing client contract line:', error);
    // Preserve the original error message if it exists
    throw new Error(error.message || 'Failed to remove client contract line');
  }
});

export const editClientContractLine = withAuth(async (
  _user,
  { tenant },
  clientContractLineId: string,
  updates: Partial<IClientContractLine>
): Promise<void> => {
  try {
    const { knex: db } = await createTenantKnex();
    const identity = ensureAssignmentScopedIdentity(parseClientContractLineIdentity(clientContractLineId));

    // Convert dates to proper format
    // Use 'any' type here to allow assigning Date objects, knex will handle them.
    const updateData: any = { ...updates };

    // Convert string dates to Date objects if they exist
    if (updates.start_date) {
        updateData.start_date = new Date(updates.start_date);
    }
    // Ensure end_date is null if not provided or empty, otherwise convert to Date
    updateData.end_date = updates.end_date ? new Date(updates.end_date) : null;

    // Ensure service_category is null for the DB if it's undefined or an empty string
    if (updates.service_category === undefined || updates.service_category === '') {
        updateData.service_category = null;
    } else {
        // Keep the valid UUID string if provided
        updateData.service_category = updates.service_category;
    }

    // --- Validation Start ---
    const latestInvoicedPeriodEnd = await getLatestAuthoritativeRecurringPeriodEndDate(db, tenant, clientContractLineId);
    assertContractLineMutationAllowed(latestInvoicedPeriodEnd, identity.contractLineId, updates);
    // --- Validation End ---

    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      await assertSharedHeaderMutationIsExplicit(trx, tenant, identity);
      updateData.cadence_owner =
        updates.cadence_owner ?? await getExistingCadenceOwner(trx, tenant, identity.contractLineId);

      // Filter updates to include only columns that exist on contract_lines
      const {
        client_contract_line_id,
        client_id,
        start_date,
        end_date,
        client_contract_id,
        template_contract_id,
        contract_name,
        service_category_name,
        ...validUpdates
      } = updateData as any;

      return await trx('contract_lines')
        .where({
          contract_line_id: identity.contractLineId,
          tenant
        })
        .update(validUpdates);
    });

    if (result === 0) {
      throw new Error('Contract Line not found or no changes were made');
    }
  } catch (error: any) {
    console.error('Error editing client contract line:', error);
    // Preserve the original error message if it exists
    throw new Error(error.message || 'Failed to edit client contract line');
  }
});
