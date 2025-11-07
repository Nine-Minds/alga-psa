'use server';

import { withTransaction } from '@alga-psa/shared/db';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import ContractLine from 'server/src/lib/models/contractLine';
import ContractLineFixedConfig from 'server/src/lib/models/contractLineFixedConfig';
import { ContractLineServiceConfigurationService } from 'server/src/lib/services/contractLineServiceConfigurationService';
import {
  getContractLineServicesWithConfigurations,
  getTemplateLineServicesWithConfigurations,
} from 'server/src/lib/actions/contractLineServiceActions';
import { getSession } from 'server/src/lib/auth/getSession';
import { ensureTemplateLineSnapshot } from 'server/src/lib/repositories/contractLineRepository';
import { fetchDetailedContractLines } from 'server/src/lib/repositories/contractLineRepository';
import {
  IContractLineServiceBucketConfig,
  IContractLineServiceHourlyConfig,
  IContractLineServiceUsageConfig,
} from 'server/src/interfaces/contractLineServiceConfiguration.interfaces';
import {
  BucketOverlayInput,
  upsertBucketOverlayInTransaction
} from 'server/src/lib/actions/bucketOverlayActions';

// ---------------------- Template wizard types ----------------------

type TemplateFixedServiceInput = {
  service_id: string;
  service_name?: string;
  quantity?: number;
  suggested_rate?: number;
};

type TemplateHourlyServiceInput = {
  service_id: string;
  service_name?: string;
  hourly_rate?: number | null;
  bucket_overlay?: BucketOverlayInput | null;
  suggested_rate?: number;
};

type TemplateUsageServiceInput = {
  service_id: string;
  service_name?: string;
  unit_of_measure?: string;
  bucket_overlay?: BucketOverlayInput | null;
  suggested_rate?: number;
};

export type ContractTemplateWizardSubmission = {
  contract_name: string;
  description?: string;
  billing_frequency?: string;
  fixed_services: TemplateFixedServiceInput[];
  hourly_services?: TemplateHourlyServiceInput[];
  usage_services?: TemplateUsageServiceInput[];
  minimum_billable_time?: number;
  round_up_to_nearest?: number;
  fixed_base_rate?: number;
  enable_proration?: boolean;
};

type TemplateOption = {
  contract_id: string;
  contract_name: string;
  contract_description?: string | null;
  billing_frequency?: string | null;
};

// ---------------------- Client wizard types ----------------------

type ClientFixedServiceInput = {
  service_id: string;
  service_name?: string;
  quantity: number;
  bucket_overlay?: BucketOverlayInput | null;
};

type ClientHourlyServiceInput = {
  service_id: string;
  service_name?: string;
  hourly_rate?: number;
  bucket_overlay?: BucketOverlayInput | null;
};

type ClientUsageServiceInput = {
  service_id: string;
  service_name?: string;
  unit_rate?: number;
  unit_of_measure?: string;
  bucket_overlay?: BucketOverlayInput | null;
};

export type ClientContractWizardSubmission = {
  contract_name: string;
  description?: string;
  company_id: string;
  start_date: string;
  billing_frequency?: string;
  end_date?: string;
  po_required?: boolean;
  po_number?: string;
  po_amount?: number;
  fixed_base_rate?: number;
  fixed_billing_frequency?: string;
  enable_proration: boolean;
  fixed_services: ClientFixedServiceInput[];
  hourly_services?: ClientHourlyServiceInput[];
  hourly_billing_frequency?: string;
  usage_services?: ClientUsageServiceInput[];
  usage_billing_frequency?: string;
  minimum_billable_time?: number;
  round_up_to_nearest?: number;
  template_id?: string;
};

export type ClientTemplateSnapshot = {
  contract_name?: string;
  description?: string | null;
  billing_frequency?: string | null;
  fixed_services?: ClientFixedServiceInput[];
  fixed_base_rate?: number;
  enable_proration?: boolean;
  hourly_services?: ClientHourlyServiceInput[];
  usage_services?: ClientUsageServiceInput[];
  minimum_billable_time?: number;
  round_up_to_nearest?: number;
};

export type ContractWizardResult = {
  contract_id: string;
  contract_line_id?: string;
  contract_line_ids?: string[];
};

const normalizeDateOnly = (input?: string): string | undefined => {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (trimmed.includes('T')) return trimmed.split('T')[0];
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const [, mmRaw, ddRaw, yyyy] = match;
    const mm = mmRaw.padStart(2, '0');
    const dd = ddRaw.padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return trimmed;
};

const isBucketConfig = (
  config: IContractLineServiceBucketConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | null
): config is IContractLineServiceBucketConfig =>
  Boolean(config && 'total_minutes' in config && 'overage_rate' in config && 'allow_rollover' in config);

const isHourlyConfig = (
  config: IContractLineServiceBucketConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | null
): config is IContractLineServiceHourlyConfig =>
  Boolean(config && 'hourly_rate' in config && 'minimum_billable_time' in config);

const isUsageConfig = (
  config: IContractLineServiceBucketConfig | IContractLineServiceHourlyConfig | IContractLineServiceUsageConfig | null
): config is IContractLineServiceUsageConfig =>
  Boolean(config && 'unit_of_measure' in config && 'enable_tiered_pricing' in config);

// ---------------------------------------------------------------------------
// Template wizard
// ---------------------------------------------------------------------------

export async function createContractTemplateFromWizard(
  submission: ContractTemplateWizardSubmission,
  options?: { isDraft?: boolean }
): Promise<ContractWizardResult> {
  const isDraft = options?.isDraft ?? false;
  const isBypass = process.env.E2E_AUTH_BYPASS === 'true';
  const currentUser = isBypass ? ({} as any) : await getCurrentUser();
  if (!currentUser && !isBypass) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    if (!isBypass) {
      const canCreateBilling = await hasPermission(currentUser, 'billing', 'create', trx);
      const canUpdateBilling = await hasPermission(currentUser, 'billing', 'update', trx);
      if (!canCreateBilling || !canUpdateBilling) {
        throw new Error('Permission denied: Cannot create billing templates');
      }
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const templateId = uuidv4();

    await trx('contract_templates').insert({
      tenant,
      template_id: templateId,
      template_name: submission.contract_name,
      template_description: submission.description ?? null,
      default_billing_frequency: submission.billing_frequency ?? 'monthly',
      template_status: isDraft ? 'draft' : 'published',
      template_metadata: null,
      created_at: nowIso,
      updated_at: nowIso,
    });

    const filteredFixedServices = (submission.fixed_services || []).filter((service) => service?.service_id);
    const filteredHourlyServices = (submission.hourly_services || []).filter((service) => service?.service_id);
    const filteredUsageServices = (submission.usage_services || []).filter((service) => service?.service_id);

    const allServiceIds = [
      ...filteredFixedServices.map((s) => s.service_id),
      ...filteredHourlyServices.map((s) => s.service_id),
      ...filteredUsageServices.map((s) => s.service_id),
    ];

    if (allServiceIds.length > 0) {
      const services = await trx('service_catalog')
        .whereIn('service_id', allServiceIds)
        .select('service_id', 'service_name', 'billing_method');

      const validateBillingMethod = (
        expected: 'fixed' | 'hourly' | 'usage',
        items: Array<{ service_id: string }>
      ) => {
        for (const item of items) {
          const match = services.find((s) => s.service_id === item.service_id);
          if (match && match.billing_method !== expected) {
            throw new Error(
              `Service "${match.service_name}" has billing method "${match.billing_method}" but can only be added to ${expected} contract lines`
            );
          }
        }
      };

      validateBillingMethod('fixed', filteredFixedServices);
      validateBillingMethod('hourly', filteredHourlyServices);
      validateBillingMethod('usage', filteredUsageServices);
    }

    const createdContractLineIds: string[] = [];
    let primaryContractLineId: string | undefined;
    let nextDisplayOrder = 0;
    const planServiceConfigService = new ContractLineServiceConfigurationService(trx, tenant);

    const recordTemplateMapping = async (lineId: string, customRate?: number | null) => {
      const effectiveLineId = await ensureTemplateLineSnapshot(
        trx,
        tenant,
        templateId,
        lineId,
        customRate ?? undefined
      );

      await trx('contract_template_lines')
        .where({
          tenant,
          template_id: templateId,
          template_line_id: effectiveLineId,
        })
        .update({
          display_order: nextDisplayOrder,
          custom_rate: customRate ?? null,
          updated_at: trx.fn.now(),
        });

      nextDisplayOrder += 1;
    };

    if (filteredFixedServices.length > 0) {
      const createdFixedLine = await ContractLine.create(trx, {
        contract_line_name: `${submission.contract_name} - Fixed Fee`,
        billing_frequency: submission.billing_frequency ?? 'monthly',
        is_custom: true,
        service_category: null as any,
        contract_line_type: 'Fixed',
        hourly_rate: null,
        minimum_billable_time: null,
        round_up_to_nearest: null,
        enable_overtime: null,
        overtime_rate: null,
        overtime_threshold: null,
        enable_after_hours_rate: null,
        after_hours_multiplier: null,
        is_template: true,
      } as any);
      const planId = createdFixedLine.contract_line_id!;
      createdContractLineIds.push(planId);
      if (!primaryContractLineId) {
        primaryContractLineId = planId;
      }

      const totalQuantity = filteredFixedServices.reduce((sum, svc) => sum + (svc.quantity ?? 1), 0) || filteredFixedServices.length;
      let allocated = 0;
      const fixedBaseRateCents = submission.fixed_base_rate ?? 0;

      for (const [index, service] of filteredFixedServices.entries()) {
        const quantity = service.quantity ?? 1;

        await trx('contract_line_services').insert({
          tenant,
          contract_line_id: planId,
          service_id: service.service_id,
        });

        let serviceBaseRate = 0;
        if (fixedBaseRateCents) {
          const share = quantity / totalQuantity;
          const provisionalValue = fixedBaseRateCents * share;
          if (index === filteredFixedServices.length - 1) {
            serviceBaseRate = fixedBaseRateCents - allocated;
          } else {
            serviceBaseRate = Math.round(provisionalValue);
            allocated = Math.round(allocated + serviceBaseRate);
          }
        }

        await planServiceConfigService.createConfiguration(
          {
            contract_line_id: planId,
            service_id: service.service_id,
            configuration_type: 'Fixed',
            quantity,
            tenant,
            custom_rate: undefined,
          },
          { base_rate: (serviceBaseRate ?? 0) / 100 }
        );
      }

      const fixedConfigModel = new ContractLineFixedConfig(trx, tenant);
      const enableProrationFlag = Boolean(submission.enable_proration);
      await fixedConfigModel.upsert({
        contract_line_id: planId,
        base_rate: fixedBaseRateCents / 100,
        enable_proration: enableProrationFlag,
        billing_cycle_alignment: enableProrationFlag ? 'prorated' : 'start',
        tenant,
      });

      await recordTemplateMapping(planId, null);
    }

    if (filteredHourlyServices.length > 0) {
      const createdHourlyLine = await ContractLine.create(trx, {
        contract_line_name: `${submission.contract_name} - Hourly`,
        billing_frequency: submission.billing_frequency ?? 'monthly',
        is_custom: true,
        service_category: null as any,
        contract_line_type: 'Hourly',
        is_template: true,
        minimum_billable_time: submission.minimum_billable_time ?? 15,
        round_up_to_nearest: submission.round_up_to_nearest ?? 15,
      } as any);
      const hourlyPlanId = createdHourlyLine.contract_line_id!;
      createdContractLineIds.push(hourlyPlanId);
      if (!primaryContractLineId) {
        primaryContractLineId = hourlyPlanId;
      }

      for (const service of filteredHourlyServices) {
        const normalizedHourlyRate = Math.max(0, Math.round(service.hourly_rate ?? 0));

        await trx('contract_line_services').insert({
          tenant,
          contract_line_id: hourlyPlanId,
          service_id: service.service_id,
        });

        await planServiceConfigService.upsertPlanServiceHourlyConfiguration(hourlyPlanId, service.service_id, {
          hourly_rate: normalizedHourlyRate,
          minimum_billable_time: submission.minimum_billable_time ?? 0,
          round_up_to_nearest: submission.round_up_to_nearest ?? 0,
        });

        if (service.bucket_overlay) {
          await upsertBucketOverlayInTransaction(
            trx,
            tenant,
            hourlyPlanId,
            service.service_id,
            service.bucket_overlay,
            null,
            null
          );
        }
      }

      await recordTemplateMapping(hourlyPlanId, null);
    }

    if (filteredUsageServices.length > 0) {
      const createdUsageLine = await ContractLine.create(trx, {
        contract_line_name: `${submission.contract_name} - Usage`,
        billing_frequency: submission.billing_frequency ?? 'monthly',
        is_custom: true,
        service_category: null as any,
        contract_line_type: 'Usage',
        is_template: true,
      } as any);
      const usagePlanId = createdUsageLine.contract_line_id!;
      createdContractLineIds.push(usagePlanId);
      if (!primaryContractLineId) {
        primaryContractLineId = usagePlanId;
      }

      for (const service of filteredUsageServices) {
        await trx('contract_line_services').insert({
          tenant,
          contract_line_id: usagePlanId,
          service_id: service.service_id,
        });

        await planServiceConfigService.upsertPlanServiceUsageConfiguration(usagePlanId, service.service_id, {
          unit_of_measure: service.unit_of_measure || 'unit',
          enable_tiered_pricing: false,
        });

        if (service.bucket_overlay) {
          await upsertBucketOverlayInTransaction(
            trx,
            tenant,
            usagePlanId,
            service.service_id,
            service.bucket_overlay,
            null,
            null
          );
        }
      }

      await recordTemplateMapping(usagePlanId, null);
    }

    return {
      contract_id: templateId,
      contract_line_id: primaryContractLineId,
      contract_line_ids: createdContractLineIds,
    };
  });
}

// ---------------------------------------------------------------------------
// Client wizard
// ---------------------------------------------------------------------------

export async function createClientContractFromWizard(
  submission: ClientContractWizardSubmission,
  options?: { isDraft?: boolean }
): Promise<ContractWizardResult> {
  const isDraft = options?.isDraft ?? false;
  const isBypass = process.env.E2E_AUTH_BYPASS === 'true';
  const currentUser = isBypass ? ({} as any) : await getCurrentUser();
  if (!currentUser && !isBypass) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    if (!isBypass) {
      const canCreateBilling = await hasPermission(currentUser, 'billing', 'create', trx);
      const canUpdateBilling = await hasPermission(currentUser, 'billing', 'update', trx);
      if (!canCreateBilling || !canUpdateBilling) {
        throw new Error('Permission denied: Cannot create billing contracts');
      }
    }

    const startDate = normalizeDateOnly(submission.start_date);
    if (!startDate) {
      throw new Error('Contract start date is required');
    }
    const endDate = normalizeDateOnly(submission.end_date) ?? null;

    const now = new Date();
    const contractId = uuidv4();
    await trx('contracts').insert({
      tenant,
      contract_id: contractId,
      contract_name: submission.contract_name,
      contract_description: submission.description ?? null,
      billing_frequency: submission.billing_frequency ?? 'monthly',
      is_active: !isDraft,
      status: isDraft ? 'draft' : 'active',
      is_template: false,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });

    const fixedServiceInputs = Array.isArray(submission.fixed_services) ? submission.fixed_services : [];
    const hourlyServiceInputs = Array.isArray(submission.hourly_services) ? submission.hourly_services : [];
    const usageServiceInputs = Array.isArray(submission.usage_services) ? submission.usage_services : [];

    const filteredFixedServices = fixedServiceInputs.filter((service) => service?.service_id);
    const filteredHourlyServices = hourlyServiceInputs.filter((service) => service?.service_id);
    const filteredUsageServices = usageServiceInputs.filter((service) => service?.service_id);

    const allServiceIds = [
      ...filteredFixedServices.map((s) => s.service_id),
      ...filteredHourlyServices.map((s) => s.service_id),
      ...filteredUsageServices.map((s) => s.service_id),
    ];

    if (allServiceIds.length > 0) {
      const services = await trx('service_catalog')
        .whereIn('service_id', allServiceIds)
        .select('service_id', 'service_name', 'billing_method');

      const validateBillingMethod = (
        expected: 'fixed' | 'hourly' | 'usage',
        items: Array<{ service_id: string }>
      ) => {
        for (const item of items) {
          const match = services.find((s) => s.service_id === item.service_id);
          if (match && match.billing_method !== expected) {
            throw new Error(
              `Service "${match.service_name}" has billing method "${match.billing_method}" but can only be added to ${expected} contract lines`
            );
          }
        }
      };

      validateBillingMethod('fixed', filteredFixedServices);
      validateBillingMethod('hourly', filteredHourlyServices);
      validateBillingMethod('usage', filteredUsageServices);
    }

    const createdContractLineIds: string[] = [];
    let primaryContractLineId: string | undefined;
    let nextDisplayOrder = 0;
    const planServiceConfigService = new ContractLineServiceConfigurationService(trx, tenant);

    if (filteredFixedServices.length > 0) {
      const createdFixedLine = await ContractLine.create(trx, {
        contract_line_name: `${submission.contract_name} - Fixed Fee`,
        billing_frequency: submission.fixed_billing_frequency ?? submission.billing_frequency ?? 'monthly',
        is_custom: true,
        service_category: null as any,
        contract_line_type: 'Fixed',
        hourly_rate: null,
        minimum_billable_time: null,
        round_up_to_nearest: null,
        enable_overtime: null,
        overtime_rate: null,
        overtime_threshold: null,
        enable_after_hours_rate: null,
        after_hours_multiplier: null,
        contract_id: contractId,
        display_order: nextDisplayOrder,
        custom_rate: null,
        billing_timing: 'arrears',
        is_template: false,
      } as any);
      const planId = createdFixedLine.contract_line_id!;
      createdContractLineIds.push(planId);
      if (!primaryContractLineId) {
        primaryContractLineId = planId;
      }

      const totalQuantity = filteredFixedServices.reduce((sum, svc) => sum + (svc.quantity ?? 1), 0) || filteredFixedServices.length;
      let allocated = 0;

      for (const [index, service] of filteredFixedServices.entries()) {
        const quantity = service.quantity ?? 1;

        await trx('contract_line_services').insert({
          tenant,
          contract_line_id: planId,
          service_id: service.service_id,
        });

        let serviceBaseRate = 0;
        if (submission.fixed_base_rate) {
          const share = quantity / totalQuantity;
          const provisionalValue = submission.fixed_base_rate * share;
          if (index === filteredFixedServices.length - 1) {
            serviceBaseRate = submission.fixed_base_rate - allocated;
          } else {
            serviceBaseRate = Math.round(provisionalValue);
            allocated = Math.round(allocated + serviceBaseRate);
          }
        }

        await planServiceConfigService.createConfiguration(
          {
            contract_line_id: planId,
            service_id: service.service_id,
            configuration_type: 'Fixed',
            quantity,
            tenant,
            custom_rate: undefined,
          },
          { base_rate: (serviceBaseRate ?? 0) / 100 }
        );
      }

      const fixedConfigModel = new ContractLineFixedConfig(trx, tenant);
      await fixedConfigModel.upsert({
        contract_line_id: planId,
        base_rate: (submission.fixed_base_rate ?? 0) / 100,
        enable_proration: submission.enable_proration,
        billing_cycle_alignment: submission.enable_proration ? 'prorated' : 'start',
        tenant,
      });

      nextDisplayOrder += 1;
    }

    if (filteredHourlyServices.length > 0) {
      const createdHourlyLine = await ContractLine.create(trx, {
        contract_line_name: `${submission.contract_name} - Hourly`,
        billing_frequency: submission.hourly_billing_frequency ?? submission.billing_frequency ?? 'monthly',
        is_custom: true,
        service_category: null as any,
        contract_line_type: 'Hourly',
        minimum_billable_time: submission.minimum_billable_time ?? 15,
        round_up_to_nearest: submission.round_up_to_nearest ?? 15,
        contract_id: contractId,
        display_order: nextDisplayOrder,
        custom_rate: null,
        billing_timing: 'arrears',
        is_template: false,
      } as any);
      const hourlyPlanId = createdHourlyLine.contract_line_id!;
      createdContractLineIds.push(hourlyPlanId);
      if (!primaryContractLineId) {
        primaryContractLineId = hourlyPlanId;
      }

      for (const service of filteredHourlyServices) {
        const normalizedHourlyRate = Math.max(0, Math.round(service.hourly_rate ?? 0));
        await trx('contract_line_services').insert({
          tenant,
          contract_line_id: hourlyPlanId,
          service_id: service.service_id,
        });

        await planServiceConfigService.upsertPlanServiceHourlyConfiguration(hourlyPlanId, service.service_id, {
          hourly_rate: normalizedHourlyRate,
          minimum_billable_time: submission.minimum_billable_time ?? 0,
          round_up_to_nearest: submission.round_up_to_nearest ?? 0,
        });

        if (service.bucket_overlay) {
          await upsertBucketOverlayInTransaction(
            trx,
            tenant,
            hourlyPlanId,
            service.service_id,
            service.bucket_overlay,
            null,
            null
          );
        }
      }

      nextDisplayOrder += 1;
    }

    if (filteredUsageServices.length > 0) {
      const createdUsageLine = await ContractLine.create(trx, {
        contract_line_name: `${submission.contract_name} - Usage`,
        billing_frequency: submission.usage_billing_frequency ?? submission.billing_frequency ?? 'monthly',
        is_custom: true,
        service_category: null as any,
        contract_line_type: 'Usage',
        contract_id: contractId,
        display_order: nextDisplayOrder,
        custom_rate: null,
        billing_timing: 'arrears',
        is_template: false,
      } as any);
      const usagePlanId = createdUsageLine.contract_line_id!;
      createdContractLineIds.push(usagePlanId);
      if (!primaryContractLineId) {
        primaryContractLineId = usagePlanId;
      }

      for (const service of filteredUsageServices) {
        const normalizedUnitRate = Math.max(0, Math.round(service.unit_rate ?? 0));
        await trx('contract_line_services').insert({
          tenant,
          contract_line_id: usagePlanId,
          service_id: service.service_id,
        });

        await planServiceConfigService.upsertPlanServiceUsageConfiguration(usagePlanId, service.service_id, {
          unit_of_measure: service.unit_of_measure || 'unit',
          unit_rate: normalizedUnitRate,
          enable_tiered_pricing: false,
        });

        if (service.bucket_overlay) {
          await upsertBucketOverlayInTransaction(
            trx,
            tenant,
            usagePlanId,
            service.service_id,
            service.bucket_overlay,
            null,
            null
          );
        }
      }

      nextDisplayOrder += 1;
    }

    const clientContractId = uuidv4();

    await trx('client_contracts').insert({
      tenant,
      client_contract_id: clientContractId,
      client_id: submission.company_id,
      contract_id: contractId,
      start_date: startDate,
      end_date: endDate,
      is_active: !isDraft,
      po_required: submission.po_required ?? false,
      po_number: submission.po_number ?? null,
      po_amount: submission.po_amount ?? null,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      template_contract_id: submission.template_id ?? null,
    });

    if (createdContractLineIds.length > 0) {
      await replicateContractLinesToClient(trx, {
        tenant,
        clientId: submission.company_id,
        clientContractId,
        contractLineIds: createdContractLineIds,
        startDate,
        endDate,
        isActive: !isDraft
      });
    }

    return {
      contract_id: contractId,
      contract_line_id: primaryContractLineId,
      contract_line_ids: createdContractLineIds,
    };
  });
}

// ---------------------------------------------------------------------------
// Template name validation
// ---------------------------------------------------------------------------

export async function checkTemplateNameExists(templateName: string): Promise<boolean> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const existingTemplate = await knex('contract_templates')
    .where({ tenant })
    .whereRaw('LOWER(template_name) = LOWER(?)', [templateName.trim()])
    .first();

  return !!existingTemplate;
}

// ---------------------------------------------------------------------------
// Template helper queries for client wizard
// ---------------------------------------------------------------------------

export async function listContractTemplatesForWizard(): Promise<TemplateOption[]> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const templates = await knex('contract_templates')
    .where({ tenant })
    .orderBy('template_name', 'asc')
    .select(
      'template_id',
      'template_name',
      'template_description',
      'default_billing_frequency'
    );

  return templates.map((template) => ({
    contract_id: template.template_id,
    contract_name: template.template_name,
    contract_description: template.template_description,
    billing_frequency: template.default_billing_frequency,
  }));
}

export async function getContractTemplateSnapshotForClientWizard(
  templateId: string
): Promise<ClientTemplateSnapshot> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const template = await knex('contract_templates')
    .where({ tenant, template_id: templateId })
    .first();

  if (!template) {
    throw new Error('Template not found');
  }

  const detailedLines = await fetchDetailedContractLines(knex, tenant, templateId);

  const fixedServices: ClientTemplateSnapshot['fixed_services'] = [];
  const hourlyServices: ClientTemplateSnapshot['hourly_services'] = [];
  const usageServices: ClientTemplateSnapshot['usage_services'] = [];
  let minimumBillableTime: number | undefined;
  let roundUpToNearest: number | undefined;
  let enableProration: boolean | undefined;
  let fixedBaseRateCents: number | undefined;

  for (const line of detailedLines) {
    const servicesWithConfig = await getTemplateLineServicesWithConfigurations(line.contract_line_id);

    if (line.contract_line_type === 'Fixed') {
      const baseRateValue =
        line.rate != null ? Number(line.rate) : undefined;
      fixedBaseRateCents = baseRateValue != null ? Math.round(baseRateValue * 100) : undefined;
      enableProration = line.enable_proration ?? false;

      servicesWithConfig.forEach(({ service, configuration, typeConfig }) => {
        const quantity =
          configuration?.quantity != null ? Number(configuration.quantity) : 1;
        const bucketConfig =
          configuration.configuration_type === 'Bucket' && isBucketConfig(typeConfig) ? typeConfig : null;

        fixedServices?.push({
          service_id: service.service_id,
          service_name: service.service_name,
          quantity,
          bucket_overlay:
            bucketConfig
              ? {
                  total_minutes: bucketConfig.total_minutes ?? undefined,
                  overage_rate:
                    bucketConfig.overage_rate != null ? Math.round(Number(bucketConfig.overage_rate)) : undefined,
                  allow_rollover: Boolean(bucketConfig.allow_rollover),
                  billing_period: bucketConfig.billing_period === 'weekly' ? 'weekly' : 'monthly',
                }
              : undefined,
        });
      });
    } else if (line.contract_line_type === 'Hourly') {
      servicesWithConfig.forEach(({ service, configuration, typeConfig }) => {
        const hourlyConfig = isHourlyConfig(typeConfig) ? typeConfig : null;
        const hourlyRateSource =
          (hourlyConfig && hourlyConfig.hourly_rate != null ? hourlyConfig.hourly_rate : configuration?.custom_rate) ??
          null;
        const hourlyRateCents =
          hourlyRateSource != null ? Math.round(Number(hourlyRateSource)) : undefined;

        const minimumBillable =
          hourlyConfig && hourlyConfig.minimum_billable_time != null
            ? Number(hourlyConfig.minimum_billable_time)
            : minimumBillableTime;
        const roundUp =
          hourlyConfig && hourlyConfig.round_up_to_nearest != null
            ? Number(hourlyConfig.round_up_to_nearest)
            : roundUpToNearest;
        minimumBillableTime = minimumBillable;
        roundUpToNearest = roundUp;

        const hourlyBucket =
          configuration.configuration_type === 'Bucket' && isBucketConfig(typeConfig) ? typeConfig : null;

        hourlyServices?.push({
          service_id: service.service_id,
          service_name: service.service_name,
          hourly_rate: hourlyRateCents,
          bucket_overlay:
            hourlyBucket
              ? {
                  total_minutes: hourlyBucket.total_minutes ?? undefined,
                  overage_rate:
                    hourlyBucket.overage_rate != null ? Math.round(Number(hourlyBucket.overage_rate)) : undefined,
                  allow_rollover: Boolean(hourlyBucket.allow_rollover),
                  billing_period: hourlyBucket.billing_period === 'weekly' ? 'weekly' : 'monthly',
                }
              : undefined,
        });
      });
    } else if (line.contract_line_type === 'Usage') {
      servicesWithConfig.forEach(({ service, configuration, typeConfig }) => {
        const usageConfig = isUsageConfig(typeConfig) ? typeConfig : null;
        const unitRateSource =
          (usageConfig && usageConfig.base_rate != null ? usageConfig.base_rate : configuration?.custom_rate) ?? null;
        const unitRateCents =
          unitRateSource != null ? Math.round(Number(unitRateSource)) : undefined;

        const usageBucket =
          configuration.configuration_type === 'Bucket' && isBucketConfig(typeConfig) ? typeConfig : null;

        usageServices?.push({
          service_id: service.service_id,
          service_name: service.service_name,
          unit_rate: unitRateCents,
          unit_of_measure:
            usageConfig?.unit_of_measure ||
            service.unit_of_measure ||
            'unit',
          bucket_overlay:
            usageBucket
              ? {
                  total_minutes: usageBucket.total_minutes ?? undefined,
                  overage_rate:
                    usageBucket.overage_rate != null ? Math.round(Number(usageBucket.overage_rate)) : undefined,
                  allow_rollover: Boolean(usageBucket.allow_rollover),
                  billing_period: usageBucket.billing_period === 'weekly' ? 'weekly' : 'monthly',
                }
              : undefined,
        });
      });
    }
  }

  return {
    contract_name: template.template_name,
    description: template.template_description,
    billing_frequency: template.default_billing_frequency,
    fixed_services: fixedServices,
    fixed_base_rate: fixedBaseRateCents,
    enable_proration: enableProration,
    hourly_services: hourlyServices,
    usage_services: usageServices,
    minimum_billable_time: minimumBillableTime,
    round_up_to_nearest: roundUpToNearest,
  };
}

interface ReplicateClientContractParams {
  tenant: string;
  clientId: string;
  clientContractId: string;
  contractLineIds: string[];
  startDate: string;
  endDate: string | null;
  isActive: boolean;
}

const toTimestamp = (dateString?: string | null): Date | null => {
  if (!dateString) {
    return null;
  }

  return new Date(`${dateString}T00:00:00.000Z`);
};

const toCurrencyOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const toDollarsFromCents = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric / 100;
};

async function replicateContractLinesToClient(
  trx: Knex.Transaction,
  params: ReplicateClientContractParams
): Promise<void> {
  const {
    tenant,
    clientId,
    clientContractId,
    contractLineIds,
    startDate,
    endDate,
    isActive
  } = params;

  if (contractLineIds.length === 0) {
    return;
  }

  const startTimestamp = toTimestamp(startDate);
  const endTimestamp = toTimestamp(endDate);

  for (const planId of contractLineIds) {
    const plan = await trx('contract_lines')
      .where({ tenant, contract_line_id: planId })
      .first([
        'contract_line_id',
        'contract_line_type',
        'service_category',
        'enable_proration',
        'billing_cycle_alignment'
      ]);

    if (!plan) {
      continue;
    }

    const clientContractLineId = uuidv4();

    await trx('client_contract_lines').insert({
      tenant,
      client_contract_line_id: clientContractLineId,
      client_id: clientId,
      contract_line_id: planId,
      service_category: plan.service_category ?? null,
      is_active: isActive,
      start_date: startTimestamp,
      end_date: endTimestamp,
      client_contract_id: clientContractId,
      template_contract_line_id: null
    });

    const planServices = await trx('contract_line_services')
      .where({ tenant, contract_line_id: planId })
      .select(['service_id', 'quantity', 'custom_rate']);

    const serviceToClientServiceId = new Map<string, string>();

    for (const serviceRow of planServices) {
      const clientServiceId = uuidv4();
      const quantity =
        serviceRow.quantity !== null && serviceRow.quantity !== undefined
          ? Number(serviceRow.quantity)
          : null;
      const customRate = toDollarsFromCents(serviceRow.custom_rate);

      await trx('client_contract_services').insert({
        tenant,
        client_contract_service_id: clientServiceId,
        client_contract_line_id: clientContractLineId,
        service_id: serviceRow.service_id,
        quantity,
        custom_rate: customRate,
        effective_date: startTimestamp
      });

      serviceToClientServiceId.set(serviceRow.service_id, clientServiceId);
    }

    const planConfigs = await trx('contract_line_service_configuration')
      .where({ tenant, contract_line_id: planId })
      .select(['config_id', 'service_id', 'configuration_type', 'custom_rate', 'quantity']);

    for (const config of planConfigs) {
      const clientServiceId = serviceToClientServiceId.get(config.service_id);
      if (!clientServiceId) {
        continue;
      }

      const clientConfigId = uuidv4();

      await trx('client_contract_service_configuration').insert({
        tenant,
        config_id: clientConfigId,
        client_contract_service_id: clientServiceId,
        configuration_type: config.configuration_type,
        custom_rate: toCurrencyOrNull(config.custom_rate),
        quantity:
          config.quantity !== null && config.quantity !== undefined
            ? Number(config.quantity)
            : null
      });

      if (config.configuration_type === 'Fixed') {
        const planFixedConfig = await trx('contract_line_service_fixed_config')
          .where({ tenant, config_id: config.config_id })
          .first(['base_rate']);

        await trx('client_contract_service_fixed_config').insert({
          tenant,
          config_id: clientConfigId,
          base_rate: toCurrencyOrNull(planFixedConfig?.base_rate),
          enable_proration: Boolean(plan.enable_proration),
          billing_cycle_alignment: plan.billing_cycle_alignment ?? 'start'
        });

        const planBucketConfig = await trx('contract_line_service_bucket_config')
          .where({ tenant, config_id: config.config_id })
          .first([
            'total_minutes',
            'billing_period',
            'overage_rate',
            'allow_rollover'
          ]);

        if (planBucketConfig) {
          await trx('client_contract_service_bucket_config').insert({
            tenant,
            config_id: clientConfigId,
            total_minutes: planBucketConfig.total_minutes ?? 0,
            billing_period: planBucketConfig.billing_period ?? 'monthly',
            overage_rate: toCurrencyOrNull(planBucketConfig.overage_rate) ?? 0,
            allow_rollover: Boolean(planBucketConfig.allow_rollover)
          });
        }
      } else if (config.configuration_type === 'Hourly') {
        const hourlyCore = await trx('contract_line_service_hourly_configs')
          .where({ tenant, config_id: config.config_id })
          .first(['hourly_rate', 'minimum_billable_time', 'round_up_to_nearest']);

        if (hourlyCore) {
          await trx('client_contract_service_hourly_configs').insert({
            tenant,
            config_id: clientConfigId,
            hourly_rate: toCurrencyOrNull(hourlyCore.hourly_rate) ?? 0,
            minimum_billable_time: hourlyCore.minimum_billable_time ?? 0,
            round_up_to_nearest: hourlyCore.round_up_to_nearest ?? 0
          });
        }

        const hourlyMeta = await trx('contract_line_service_hourly_config')
          .where({ tenant, config_id: config.config_id })
          .first([
            'minimum_billable_time',
            'round_up_to_nearest',
            'enable_overtime',
            'overtime_rate',
            'overtime_threshold',
            'enable_after_hours_rate',
            'after_hours_multiplier'
          ]);

        if (hourlyMeta) {
          await trx('client_contract_service_hourly_config').insert({
            tenant,
            config_id: clientConfigId,
            minimum_billable_time: hourlyMeta.minimum_billable_time ?? 15,
            round_up_to_nearest: hourlyMeta.round_up_to_nearest ?? 15,
            enable_overtime: Boolean(hourlyMeta.enable_overtime),
            overtime_rate: toCurrencyOrNull(hourlyMeta.overtime_rate),
            overtime_threshold: hourlyMeta.overtime_threshold ?? null,
            enable_after_hours_rate: Boolean(hourlyMeta.enable_after_hours_rate),
            after_hours_multiplier: toCurrencyOrNull(hourlyMeta.after_hours_multiplier)
          });
        }
      } else if (config.configuration_type === 'Usage') {
        const usageConfig = await trx('contract_line_service_usage_config')
          .where({ tenant, config_id: config.config_id })
          .first([
            'unit_of_measure',
            'enable_tiered_pricing',
            'minimum_usage',
            'base_rate'
          ]);

        if (usageConfig) {
          await trx('client_contract_service_usage_config').insert({
            tenant,
            config_id: clientConfigId,
            unit_of_measure: usageConfig.unit_of_measure ?? 'Unit',
            enable_tiered_pricing: Boolean(usageConfig.enable_tiered_pricing),
            minimum_usage: usageConfig.minimum_usage ?? 0,
            base_rate: toCurrencyOrNull(usageConfig.base_rate)
          });

          const planTiers = await trx('contract_line_service_rate_tiers')
            .where({ tenant, config_id: config.config_id })
            .select(['min_quantity', 'max_quantity', 'rate']);

          for (const tier of planTiers) {
            await trx('client_contract_service_rate_tiers').insert({
              tenant,
              tier_id: uuidv4(),
              config_id: clientConfigId,
              min_quantity: tier.min_quantity ?? 0,
              max_quantity: tier.max_quantity ?? null,
              rate: toCurrencyOrNull(tier.rate) ?? 0
            });
          }
        }
      } else if (config.configuration_type === 'Bucket') {
        const bucketConfig = await trx('contract_line_service_bucket_config')
          .where({ tenant, config_id: config.config_id })
          .first([
            'total_minutes',
            'billing_period',
            'overage_rate',
            'allow_rollover'
          ]);

        if (bucketConfig) {
          await trx('client_contract_service_bucket_config').insert({
            tenant,
            config_id: clientConfigId,
            total_minutes: bucketConfig.total_minutes ?? 0,
            billing_period: bucketConfig.billing_period ?? 'monthly',
            overage_rate: toCurrencyOrNull(bucketConfig.overage_rate) ?? 0,
            allow_rollover: Boolean(bucketConfig.allow_rollover)
          });
        }
      }
    }
  }
}
