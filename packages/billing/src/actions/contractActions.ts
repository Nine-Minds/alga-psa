// @alga-psa/billing/actions.ts
'use server'

import Contract from '@alga-psa/billing/models/contract';
import ContractTemplateModel from '../models/contractTemplate';
import {
  IContract,
  IContractAssignmentSummary,
  IContractWithClient,
  IContractLineMapping,
} from '@alga-psa/types';
import {
  IContractTemplate,
  IContractTemplateWithLines,
} from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';

import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth/withAuth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  addContractLine as repoAddContractLine,
  fetchContractLineMappings,
  fetchDetailedContractLines,
  isContractLineAttached as repoIsContractLineAttached,
  removeContractLine as repoRemoveContractLine,
  updateContractLine as repoUpdateContractLine,
  updateContractLineRate as repoUpdateContractLineRate,
  DetailedContractLine,
} from '../repositories/contractLineRepository';



const mapTemplateToContract = (template: IContractTemplate): IContract => ({
  tenant: template.tenant,
  contract_id: template.template_id,
  contract_name: template.template_name,
  contract_description: template.template_description ?? undefined,
  billing_frequency: template.default_billing_frequency,
  // currency_code removed from templates - templates are now currency-neutral
  // When converting to contract, we use USD as default. Actual contract currency
  // is set from client's default_currency_code when creating a real contract.
  currency_code: 'USD',
  is_active: template.template_status === 'published',
  status: template.template_status,
  is_template: true,
  template_metadata: template.template_metadata ?? undefined,
  created_at: template.created_at,
  updated_at: template.updated_at,
});

async function isTemplateContract(knex: Knex, tenant: string, contractId: string): Promise<boolean> {
  const template = await knex('contract_templates')
    .where({ tenant, template_id: contractId })
    .first();
  return Boolean(template);
}

export const getContracts = withAuth(async (user, { tenant }): Promise<IContract[]> => {
  try {
    const { knex } = await createTenantKnex();

    return await Contract.getAll(knex, tenant);
  } catch (error) {
    console.error('Error fetching contracts:', error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch contracts: ${error}`);
  }
});

export const getContractTemplates = withAuth(async (user, { tenant }): Promise<IContract[]> => {
  try {
    const { knex } = await createTenantKnex();

    const templates = await ContractTemplateModel.getAll(tenant);
    return templates.map(mapTemplateToContract);
  } catch (error) {
    console.error('Error fetching contract templates:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to fetch contract templates: ${error}`);
  }
});

export const getContractsWithClients = withAuth(async (user, { tenant }): Promise<IContractWithClient[]> => {
  try {
    const { knex } = await createTenantKnex();

    return await Contract.getAllWithClients(knex, tenant);
  } catch (error) {
    console.error('Error fetching contracts with clients:', error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch contracts with clients: ${error}`);
  }
});

export const getDraftContracts = withAuth(async (user, { tenant }): Promise<IContractWithClient[]> => {
  try {
    const { knex } = await createTenantKnex();

    const rows = await knex('contracts as co')
      .leftJoin('client_contracts as cc', function () {
        this.on('co.contract_id', '=', 'cc.contract_id').andOn('co.tenant', '=', 'cc.tenant');
      })
      .leftJoin('contract_templates as template', function () {
        this.on('cc.template_contract_id', '=', 'template.template_id').andOn('cc.tenant', '=', 'template.tenant');
      })
      .leftJoin('clients as c', function () {
        this.on('cc.client_id', '=', 'c.client_id').andOn('cc.tenant', '=', 'c.tenant');
      })
      .where({ 'co.tenant': tenant })
      .andWhere((builder) => builder.whereNull('co.is_template').orWhere('co.is_template', false))
      .andWhere('co.status', 'draft')
      .select(
        'co.*',
        'cc.client_contract_id',
        'cc.template_contract_id',
        'c.client_id',
        'c.client_name',
        'cc.start_date',
        'cc.end_date',
        'template.template_name as template_contract_name'
      )
      .orderBy('co.updated_at', 'desc');

    return rows;
  } catch (error) {
    console.error('Error fetching draft contracts:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to fetch draft contracts: ${error}`);
  }
});

export const getContractById = withAuth(async (user, { tenant }, contractId: string): Promise<IContract | null> => {
  try {
    const { knex } = await createTenantKnex();

    const contract = await Contract.getById(knex, tenant, contractId);
    if (contract) {
      return { ...contract, is_template: false };
    }

    const template = await ContractTemplateModel.getById(contractId, tenant);
    if (template) {
      return mapTemplateToContract(template);
    }

    return null;
  } catch (error) {
    console.error(`Error fetching contract ${contractId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch contract: ${error}`);
  }
});

export const getContractLineMappings = withAuth(async (user, { tenant }, contractId: string): Promise<IContractLineMapping[]> => {
  const { knex } = await createTenantKnex();
  return fetchContractLineMappings(knex, tenant, contractId);
});

export const getDetailedContractLines = withAuth(async (user, { tenant }, contractId: string): Promise<DetailedContractLine[]> => {
  const { knex } = await createTenantKnex();
  return fetchDetailedContractLines(knex, tenant, contractId);
});

export const addContractLine = withAuth(async (
  user,
  { tenant },
  contractId: string,
  contractLineId: string,
  customRate?: number
): Promise<IContractLineMapping> => {
  const { knex } = await createTenantKnex();

  const canUpdate = hasPermission(user, 'billing', 'delete');
  if (!canUpdate) {
    throw new Error('Permission denied: Cannot modify contract lines');
  }

  return knex.transaction((trx: Knex.Transaction) =>
    repoAddContractLine(trx, tenant, contractId, contractLineId, customRate)
  );
});

export const removeContractLine = withAuth(async (user, { tenant }, contractId: string, contractLineId: string): Promise<void> => {
  const { knex } = await createTenantKnex();

  const canUpdate = hasPermission(user, 'billing', 'update');
  if (!canUpdate) {
    throw new Error('Permission denied: Cannot modify contract lines');
  }

  await repoRemoveContractLine(knex, tenant, contractId, contractLineId);
});

export const updateContractLineAssociation = withAuth(async (
  user,
  { tenant },
  contractId: string,
  contractLineId: string,
  updateData: Partial<IContractLineMapping>
): Promise<IContractLineMapping> => {
  const { knex } = await createTenantKnex();

  const canUpdate = hasPermission(user, 'billing', 'update');
  if (!canUpdate) {
    throw new Error('Permission denied: Cannot modify contract lines');
  }

  return repoUpdateContractLine(knex, tenant, contractId, contractLineId, updateData);
});

export const updateContractLineRate = withAuth(async (
  user,
  { tenant },
  contractId: string,
  contractLineId: string,
  rate: number,
  billingTiming?: 'arrears' | 'advance'
): Promise<void> => {
  const { knex } = await createTenantKnex();

  const canUpdate = hasPermission(user, 'billing', 'update');
  if (!canUpdate) {
    throw new Error('Permission denied: Cannot modify contract lines');
  }

  await knex.transaction(async (trx) => {
    await repoUpdateContractLineRate(trx, tenant, contractId, contractLineId, rate, billingTiming);
  });
});

export const isContractLineAttached = withAuth(async (user, { tenant }, contractId: string, contractLineId: string): Promise<boolean> => {
  const { knex } = await createTenantKnex();

  return repoIsContractLineAttached(knex, tenant, contractId, contractLineId);
});

export const createContract = withAuth(async (
  user,
  { tenant },
  contractData: Omit<IContract, 'contract_id' | 'tenant' | 'created_at' | 'updated_at'>
): Promise<IContract> => {
  const { knex } = await createTenantKnex();

  try {
    const { tenant: _, ...safeContractData } = contractData as any;
    return await Contract.create(knex, tenant, safeContractData);
  } catch (error) {
    console.error('Error creating contract:', error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to create contract in tenant ${tenant}: ${error}`);
  }
});

export const updateContract = withAuth(async (
  user,
  { tenant },
  contractId: string,
  updateData: Partial<IContract>
): Promise<IContract> => {
  const { knex } = await createTenantKnex();

  try {
    // Attempt to load standard contract first; fall back to template
    const currentContract = await Contract.getById(knex, tenant, contractId);
    if (!currentContract) {
      const template = await ContractTemplateModel.getById(contractId, tenant);
      if (!template) {
        throw new Error(`Contract ${contractId} not found`);
      }

      const templateUpdates: Partial<IContractTemplate> = {};

      if (typeof updateData.contract_name === 'string') {
        templateUpdates.template_name = updateData.contract_name;
      }
      if (updateData.contract_description !== undefined) {
        templateUpdates.template_description = updateData.contract_description ?? null;
      }
      if (typeof updateData.billing_frequency === 'string') {
        templateUpdates.default_billing_frequency = updateData.billing_frequency;
      }
      // currency_code removed from templates - templates are now currency-neutral
      // Currency is inherited from the client when a contract is created
      if (updateData.status && ['draft', 'published', 'archived'].includes(updateData.status)) {
        templateUpdates.template_status = updateData.status as IContractTemplate['template_status'];
      }
      if (updateData.template_metadata !== undefined) {
        templateUpdates.template_metadata = updateData.template_metadata ?? null;
      }

      if (Object.keys(templateUpdates).length === 0) {
        return mapTemplateToContract(template);
      }

      const updatedTemplate = await ContractTemplateModel.update(contractId, templateUpdates, tenant);
      return mapTemplateToContract(updatedTemplate);
    }

    // Special handling for expired contracts
    if (currentContract.status === 'expired') {
      // If trying to manually change status of an expired contract (not through end date logic)
      if (updateData.status && updateData.status !== 'expired') {
        throw new Error('Cannot manually change the status of an expired contract. To reactivate, extend the contract end date.');
      }

      // Check if end dates are being updated on client contracts
      // We'll check this after the client contract updates below
      // For now, remove the status from updateData if it's expired (we'll handle it automatically)
      if (updateData.status === 'expired') {
        delete updateData.status; // Don't update status, we'll determine it based on end dates
      }
    } else {
      // Prevent manual setting of expired status on non-expired contracts
      if (updateData.status === 'expired') {
        throw new Error('Cannot manually set contract to expired. Contracts are automatically expired when their end date passes.');
      }
    }

    // If trying to set contract to draft, check if it has invoices
    if (updateData.status === 'draft') {
      const hasInvoices = await Contract.hasInvoices(knex, tenant, contractId);
      if (hasInvoices) {
        throw new Error('Cannot set contract to draft because it has associated invoices. Contracts with invoices cannot be set to draft.');
      }
    }

    // If trying to set contract to active, check if client already has an active contract
    if (updateData.status === 'active') {
      // Get all clients assigned to this contract
      const clientContracts = await knex('client_contracts')
        .where({ contract_id: contractId, tenant })
        .select('client_id');

      for (const cc of clientContracts) {
        const hasActiveContract = await Contract.hasActiveContractForClient(knex, tenant, cc.client_id, contractId);
        if (hasActiveContract) {
          throw new Error('Client already has an active contract. To create a new active contract, terminate their current contract or save this contract as a draft.');
        }
      }
    }

    const { tenant: _, ...safeUpdateData } = updateData as any;
    const updated = await Contract.update(knex, tenant, contractId, safeUpdateData);

    // After updating, check if an expired contract should be reactivated based on end dates
    if (currentContract.status === 'expired') {
      await Contract.checkAndReactivateExpiredContract(knex, tenant, contractId);
      // Re-fetch the contract to get the potentially updated status
      const reactivatedContract = await Contract.getById(knex, tenant, contractId);
      return reactivatedContract!;
    }

    return updated;
  } catch (error) {
    console.error('Error updating contract:', error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to update contract in tenant ${tenant}: ${error}`);
  }
});

export const checkContractHasInvoices = withAuth(async (user, { tenant }, contractId: string): Promise<boolean> => {
  const { knex } = await createTenantKnex();

  return await Contract.hasInvoices(knex, tenant, contractId);
});

export const deleteContract = withAuth(async (user, { tenant }, contractId: string): Promise<void> => {
  const { knex } = await createTenantKnex();

  try {
    const isBypass = process.env.E2E_AUTH_BYPASS === 'true';
    if (!isBypass) {
      const canDeleteBilling = hasPermission(user, 'billing', 'delete');
      if (!canDeleteBilling) {
        throw new Error('Permission denied: Cannot delete billing contracts');
      }
    }

    const templateExists = await isTemplateContract(knex, tenant, contractId);
    if (templateExists) {
      await ContractTemplateModel.delete(contractId, tenant);
      return;
    }

    await Contract.delete(knex, tenant, contractId);
  } catch (error) {
    console.error('Error deleting contract:', error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages from the model
    }
    throw new Error(`Failed to delete contract in tenant ${tenant}: ${error}`);
  }
});

export const getContractLinesForContract = withAuth(async (user, { tenant }, contractId: string): Promise<any[]> => {
  try {
    const { knex } = await createTenantKnex();

    return await Contract.getContractLines(knex, tenant, contractId);
  } catch (error) {
    console.error(`Error fetching contract lines for contract ${contractId}:`, error);
    if (error instanceof Error) {
      throw error; // Preserve specific error messages
    }
    throw new Error(`Failed to fetch contract lines: ${error}`);
  }
});

export interface IContractSummary {
  contractLineCount: number;
  totalClientAssignments: number;
  activeClientCount: number;
  poRequiredCount: number;
  poNumbers: string[];
  earliestStartDate: string | null;
  latestEndDate: string | null;
}

export const getContractSummary = withAuth(async (user, { tenant }, contractId: string): Promise<IContractSummary> => {
  try {
    const { knex } = await createTenantKnex();

    const templateRecord = await knex('contract_templates')
      .where({ tenant, template_id: contractId })
      .first();

    let lineCountRaw: string | undefined;
    if (templateRecord) {
      const templateLineCount = await knex('contract_template_lines')
        .where({ template_id: contractId, tenant })
        .count('* as count')
        .first() as { count: string } | undefined;
      lineCountRaw = templateLineCount?.count;
    } else {
      const result = await knex('contract_lines')
        .where({ contract_id: contractId, tenant })
        .count('* as count')
        .first() as { count: string } | undefined;
      lineCountRaw = result?.count;
    }

    const hasPoRequired = await knex.schema.hasColumn('client_contracts', 'po_required');
    const hasPoNumber = await knex.schema.hasColumn('client_contracts', 'po_number');

    const assignmentColumns = [
      'client_contract_id',
      'client_id',
      'is_active',
      'start_date',
      'end_date'
    ];

    if (hasPoRequired) {
      assignmentColumns.push('po_required');
    }

    if (hasPoNumber) {
      assignmentColumns.push('po_number');
    }

    const assignmentsRaw = await knex('client_contracts')
      .where(function whereContractOrTemplate(this: any) {
        this.where({ contract_id: contractId }).orWhere({ template_contract_id: contractId });
      })
      .andWhere({ tenant })
      .select(assignmentColumns);

    const assignments = assignmentsRaw.map((assignment: any) => ({
      ...assignment,
      po_required: hasPoRequired ? Boolean(assignment.po_required) : false,
      po_number: hasPoNumber ? assignment.po_number : undefined,
    }));

    const totalAssignments = assignments.length;
    const activeAssignments = assignments.filter((assignment) => assignment.is_active).length;
    const poRequiredAssignments = assignments.filter((assignment) => assignment.po_required).length;

    const poNumbers = Array.from(
      new Set(
        assignments
          .map((assignment) => assignment.po_number)
          .filter((poNumber): poNumber is string => Boolean(poNumber))
      )
    );

    const startDates = assignments
      .map((assignment) => assignment.start_date)
      .filter((value): value is string => Boolean(value))
      .sort();

    const endDates = assignments
      .map((assignment) => assignment.end_date)
      .filter((value): value is string => Boolean(value))
      .sort();

    return {
      contractLineCount: Number(lineCountRaw ?? 0),
      totalClientAssignments: totalAssignments,
      activeClientCount: activeAssignments,
      poRequiredCount: poRequiredAssignments,
      poNumbers,
      earliestStartDate: startDates[0] ?? null,
      latestEndDate: endDates.length > 0 ? endDates[endDates.length - 1] : null,
    };
  } catch (error) {
    console.error(`Error computing summary for contract ${contractId}:`, error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to compute contract summary: ${error}`);
  }
});

export const checkClientHasActiveContract = withAuth(async (user, { tenant }, clientId: string, excludeContractId?: string): Promise<boolean> => {
  const { knex } = await createTenantKnex();

  try {
    return await Contract.hasActiveContractForClient(knex, tenant, clientId, excludeContractId);
  } catch (error) {
    console.error(`Error checking active contract for client ${clientId}:`, error);
    throw error;
  }
});

export const getContractAssignments = withAuth(async (user, { tenant }, contractId: string): Promise<IContractAssignmentSummary[]> => {
  try {
    const { knex } = await createTenantKnex();

    const hasPoRequired = await knex.schema.hasColumn('client_contracts', 'po_required');
    const hasPoNumber = await knex.schema.hasColumn('client_contracts', 'po_number');
    const hasPoAmount = await knex.schema.hasColumn('client_contracts', 'po_amount');

    const selection = [
      'cc.client_contract_id',
      'cc.client_id',
      'cc.start_date',
      'cc.end_date',
      'cc.is_active',
      'cc.tenant',
      'c.client_name'
    ];

    if (hasPoRequired) {
      selection.push('cc.po_required');
    }
    if (hasPoNumber) {
      selection.push('cc.po_number');
    }
    if (hasPoAmount) {
      selection.push('cc.po_amount');
    }

    const rows = await knex('client_contracts as cc')
      .leftJoin('clients as c', function joinClients() {
        this.on('cc.client_id', '=', 'c.client_id').andOn('cc.tenant', '=', 'c.tenant');
      })
      .where(function whereContractOrTemplate(this: any) {
        this.where({ 'cc.contract_id': contractId })
          .orWhere({ 'cc.template_contract_id': contractId });
      })
      .andWhere({ 'cc.tenant': tenant })
      .select(selection)
      .orderBy('cc.start_date', 'asc');

    return rows.map((row: any) => ({
      client_contract_id: row.client_contract_id,
      client_id: row.client_id,
      client_name: row.client_name ?? null,
      start_date: row.start_date ?? null,
      end_date: row.end_date ?? null,
      is_active: row.is_active ?? false,
      po_required: hasPoRequired ? Boolean(row.po_required) : false,
      po_number: hasPoNumber ? row.po_number : undefined,
      po_amount: hasPoAmount ? row.po_amount : undefined,
      tenant: row.tenant,
    }));
  } catch (error) {
    console.error(`Error fetching assignments for contract ${contractId}:`, error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to fetch contract assignments: ${error}`);
  }
});

/**
 * Contract line overview with services for display in the contract overview
 */
export interface IContractLineOverview {
  contract_line_id: string;
  contract_line_name: string;
  contract_line_type: 'Fixed' | 'Hourly' | 'Usage';
  billing_frequency: string;
  base_rate: number | null;  // For fixed lines - in cents
  display_order: number;
  services: {
    service_id: string;
    service_name: string;
    billing_method: string;
    custom_rate: number | null;  // In cents
    quantity: number | null;
    unit_of_measure: string | null;
  }[];
}

/**
 * Complete contract overview data for at-a-glance display
 */
export interface IContractOverview {
  contractLines: IContractLineOverview[];
  totalEstimatedMonthlyValue: number | null;  // In cents, null if not calculable
  serviceCount: number;
  hasHourlyServices: boolean;
  hasUsageServices: boolean;
  hasFixedServices: boolean;
  currencyCode: string;  // ISO currency code (e.g., 'USD', 'AUD')
}

/**
 * Get comprehensive contract overview including contract lines, services, and estimated value
 */
export const getContractOverview = withAuth(async (user, { tenant }, contractId: string): Promise<IContractOverview> => {
  try {
    const { knex } = await createTenantKnex();

    // Check if this is a template contract
    const templateRecord = await knex('contract_templates')
      .where({ tenant, template_id: contractId })
      .first();

    const isTemplate = Boolean(templateRecord);

    // Get currency code - templates default to USD, contracts have their own currency
    let currencyCode = 'USD';
    if (!isTemplate) {
      const contractRecord = await knex('contracts')
        .where({ tenant, contract_id: contractId })
        .select('currency_code')
        .first();
      if (contractRecord?.currency_code) {
        currencyCode = contractRecord.currency_code;
      }
    }

    let contractLines: IContractLineOverview[] = [];

    if (isTemplate) {
      // Get template lines with their services
      const lines = await knex('contract_template_lines as ctl')
        .leftJoin('contract_template_line_fixed_config as tfc', function() {
          this.on('ctl.template_line_id', '=', 'tfc.template_line_id')
            .andOn('ctl.tenant', '=', 'tfc.tenant');
        })
        .where({ 'ctl.template_id': contractId, 'ctl.tenant': tenant })
        .select([
          'ctl.template_line_id as contract_line_id',
          'ctl.template_line_name as contract_line_name',
          'ctl.line_type as contract_line_type',
          'ctl.billing_frequency',
          'ctl.display_order',
          'tfc.base_rate'
        ])
        .orderBy('ctl.display_order', 'asc');

      // Get services for each line
      for (const line of lines) {
        const services = await knex('contract_template_line_services as ctls')
          .leftJoin('service_catalog as s', function() {
            this.on('ctls.service_id', '=', 's.service_id')
              .andOn('s.tenant', '=', knex.raw('?', [tenant]));
          })
          .where({ 'ctls.template_line_id': line.contract_line_id, 'ctls.tenant': tenant })
          .select([
            'ctls.service_id',
            's.service_name',
            's.billing_method',
            'ctls.custom_rate',
            'ctls.quantity'
          ]);

        // Get service configurations for rates
        const configs = await knex('contract_template_line_service_configuration as config')
          .where({ 'config.template_line_id': line.contract_line_id, 'config.tenant': tenant })
          .select(['config.service_id', 'config.custom_rate', 'config.quantity']);

        const configMap = new Map(configs.map(c => [c.service_id, c]));

        contractLines.push({
          contract_line_id: line.contract_line_id,
          contract_line_name: line.contract_line_name,
          contract_line_type: (line.contract_line_type || 'Fixed') as 'Fixed' | 'Hourly' | 'Usage',
          billing_frequency: line.billing_frequency || 'monthly',
          base_rate: line.base_rate ? Number(line.base_rate) : null,
          display_order: line.display_order ?? 0,
          services: services.map(svc => {
            const config = configMap.get(svc.service_id);
            return {
              service_id: svc.service_id,
              service_name: svc.service_name || 'Unknown Service',
              billing_method: svc.billing_method || 'fixed',
              custom_rate: config?.custom_rate ? Number(config.custom_rate) : (svc.custom_rate ? Number(svc.custom_rate) : null),
              quantity: config?.quantity ?? svc.quantity ?? 1,
              unit_of_measure: null
            };
          })
        });
      }
    } else {
      // Get regular contract lines with their services
      // Note: For regular contracts, custom_rate is stored directly on contract_lines table
      const lines = await knex('contract_lines as cl')
        .where({ 'cl.contract_id': contractId, 'cl.tenant': tenant })
        .select([
          'cl.contract_line_id',
          'cl.contract_line_name',
          'cl.contract_line_type',
          'cl.billing_frequency',
          'cl.display_order',
          'cl.custom_rate as base_rate'
        ])
        .orderBy('cl.display_order', 'asc');

      // Get services for each line
      for (const line of lines) {
        const services = await knex('contract_line_services as cls')
          .leftJoin('service_catalog as s', function() {
            this.on('cls.service_id', '=', 's.service_id')
              .andOn('s.tenant', '=', knex.raw('?', [tenant]));
          })
          .where({ 'cls.contract_line_id': line.contract_line_id, 'cls.tenant': tenant })
          .select([
            'cls.service_id',
            's.service_name',
            's.billing_method',
            's.unit_of_measure'
          ]);

        // Get service configurations for rates
        const configs = await knex('contract_line_service_configuration as config')
          .where({ 'config.contract_line_id': line.contract_line_id, 'config.tenant': tenant })
          .select(['config.service_id', 'config.custom_rate', 'config.quantity']);

        const configMap = new Map(configs.map(c => [c.service_id, c]));

        contractLines.push({
          contract_line_id: line.contract_line_id,
          contract_line_name: line.contract_line_name,
          contract_line_type: (line.contract_line_type || 'Fixed') as 'Fixed' | 'Hourly' | 'Usage',
          billing_frequency: line.billing_frequency || 'monthly',
          base_rate: line.base_rate ? Number(line.base_rate) : null,
          display_order: line.display_order ?? 0,
          services: services.map(svc => {
            const config = configMap.get(svc.service_id);
            return {
              service_id: svc.service_id,
              service_name: svc.service_name || 'Unknown Service',
              billing_method: svc.billing_method || 'fixed',
              custom_rate: config?.custom_rate ? Number(config.custom_rate) : null,
              quantity: config?.quantity ?? 1,
              unit_of_measure: svc.unit_of_measure || null
            };
          })
        });
      }
    }

    // Calculate totals
    const serviceCount = contractLines.reduce((acc, line) => acc + line.services.length, 0);
    const hasFixedServices = contractLines.some(line => line.contract_line_type === 'Fixed');
    const hasHourlyServices = contractLines.some(line => line.contract_line_type === 'Hourly');
    const hasUsageServices = contractLines.some(line => line.contract_line_type === 'Usage');

    // Calculate estimated monthly value (only for fixed lines)
    let totalEstimatedMonthlyValue: number | null = null;

    if (hasFixedServices && !hasHourlyServices && !hasUsageServices) {
      // All fixed - we can calculate
      totalEstimatedMonthlyValue = contractLines
        .filter(line => line.contract_line_type === 'Fixed' && line.base_rate !== null)
        .reduce((acc, line) => {
          let monthlyRate = line.base_rate!;
          // Normalize to monthly
          if (line.billing_frequency === 'weekly') {
            monthlyRate = monthlyRate * 4.33;
          } else if (line.billing_frequency === 'quarterly') {
            monthlyRate = monthlyRate / 3;
          } else if (line.billing_frequency === 'semi-annually' || line.billing_frequency === 'semi_annually') {
            monthlyRate = monthlyRate / 6;
          } else if (line.billing_frequency === 'annually') {
            monthlyRate = monthlyRate / 12;
          }
          return acc + monthlyRate;
        }, 0);
    } else if (hasFixedServices) {
      // Mixed - calculate fixed portion only
      totalEstimatedMonthlyValue = contractLines
        .filter(line => line.contract_line_type === 'Fixed' && line.base_rate !== null)
        .reduce((acc, line) => {
          let monthlyRate = line.base_rate!;
          // Normalize to monthly
          if (line.billing_frequency === 'weekly') {
            monthlyRate = monthlyRate * 4.33;
          } else if (line.billing_frequency === 'quarterly') {
            monthlyRate = monthlyRate / 3;
          } else if (line.billing_frequency === 'semi-annually' || line.billing_frequency === 'semi_annually') {
            monthlyRate = monthlyRate / 6;
          } else if (line.billing_frequency === 'annually') {
            monthlyRate = monthlyRate / 12;
          }
          return acc + monthlyRate;
        }, 0);
    }

    return {
      contractLines,
      totalEstimatedMonthlyValue,
      serviceCount,
      hasFixedServices,
      hasHourlyServices,
      hasUsageServices,
      currencyCode
    };
  } catch (error) {
    console.error(`Error fetching contract overview for ${contractId}:`, error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to fetch contract overview: ${error}`);
  }
});
