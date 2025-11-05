'use server';

import { withTransaction } from '@alga-psa/shared/db';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import ContractLine from 'server/src/lib/models/contractLine';
import ContractLineFixedConfig from 'server/src/lib/models/contractLineFixedConfig';
import ContractLineMapping from 'server/src/lib/models/contractLineMapping';
import { ContractLineServiceConfigurationService } from 'server/src/lib/services/contractLineServiceConfigurationService';
import {
  getContractLineServicesWithConfigurations,
  getTemplateLineServicesWithConfigurations,
} from 'server/src/lib/actions/contractLineServiceActions';
import { getSession } from 'server/src/lib/auth/getSession';
import { ensureTemplateLineSnapshot } from 'server/src/lib/actions/contractLineMappingActions';
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
};

type TemplateHourlyServiceInput = {
  service_id: string;
  service_name?: string;
  hourly_rate?: number | null;
  bucket_overlay?: BucketOverlayInput | null;
};

type TemplateUsageServiceInput = {
  service_id: string;
  service_name?: string;
  unit_of_measure?: string;
  bucket_overlay?: BucketOverlayInput | null;
};

type TemplatePresetInput = {
  preset_id: string;
  preset_name?: string;
  service_quantities?: Record<string, number>; // For Fixed presets - map of service_id to quantity
  minimum_billable_time?: number; // For Hourly presets
  round_up_to_nearest?: number; // For Hourly presets
};

export type ContractTemplateWizardSubmission = {
  contract_name: string;
  description?: string;
  billing_frequency?: string;
  fixed_services: TemplateFixedServiceInput[];
  fixed_presets?: TemplatePresetInput[];
  hourly_services?: TemplateHourlyServiceInput[];
  hourly_presets?: TemplatePresetInput[];
  usage_services?: TemplateUsageServiceInput[];
  usage_presets?: TemplatePresetInput[];
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
      await ensureTemplateLineSnapshot(trx, tenant, templateId, lineId, customRate ?? undefined);

      await trx('contract_template_line_mappings')
        .insert({
          tenant,
          template_id: templateId,
          template_line_id: lineId,
          display_order: nextDisplayOrder,
          custom_rate: customRate ?? null,
          created_at: nowIso,
        })
        .onConflict(['tenant', 'template_id', 'template_line_id'])
        .merge({
          display_order: nextDisplayOrder,
          custom_rate: customRate ?? null,
        });

      nextDisplayOrder += 1;
    };

    // Process contract line presets
    const allPresets = [
      ...(submission.fixed_presets || []),
      ...(submission.hourly_presets || []),
      ...(submission.usage_presets || []),
    ];

    for (const presetInput of allPresets) {
      const preset = await trx('contract_line_presets')
        .where({ tenant, preset_id: presetInput.preset_id })
        .first();

      if (!preset) {
        console.warn(`Preset ${presetInput.preset_id} not found, skipping`);
        continue;
      }

      // Create a contract line from the preset
      const contractLineData = {
        contract_line_name: preset.preset_name,
        contract_line_type: preset.contract_line_type,
        billing_frequency: preset.billing_frequency,
        service_category: null as any,
        is_custom: false,
        is_template: true,
      };

      const contractLine = await ContractLine.create(trx, contractLineData as any);
      const contractLineId = contractLine.contract_line_id!;
      createdContractLineIds.push(contractLineId);

      if (!primaryContractLineId) {
        primaryContractLineId = contractLineId;
      }

      // Copy services from preset
      const presetServices = await trx('contract_line_preset_services')
        .where({ tenant, preset_id: preset.preset_id })
        .select('*');

      for (const presetService of presetServices) {
        // Insert service into contract line
        await trx('contract_line_services').insert({
          tenant,
          contract_line_id: contractLineId,
          service_id: presetService.service_id,
        });

        // Determine quantity: use custom quantity if provided (for Fixed presets), otherwise use preset default
        const customQuantity = presetInput.service_quantities?.[presetService.service_id];
        const quantity = customQuantity ?? presetService.quantity ?? 1;

        // Create service configuration based on line type
        // Note: Presets are for guidance only - no rates are copied
        const baseConfig = {
          contract_line_id: contractLineId,
          service_id: presetService.service_id,
          configuration_type: preset.contract_line_type,
          custom_rate: undefined, // Presets don't include rates - for guidance only
          quantity: quantity,
          instance_name: undefined,
          tenant,
        };

        let typeConfig: any = {};
        if (preset.contract_line_type === 'Hourly') {
          // Use per-preset configuration if provided, otherwise use preset defaults
          // Treat 0, null, or undefined as "not set" and use default of 15
          const minBillableTime = (presetInput.minimum_billable_time && presetInput.minimum_billable_time > 0)
            ? presetInput.minimum_billable_time
            : (preset.minimum_billable_time && preset.minimum_billable_time > 0)
              ? preset.minimum_billable_time
              : 15;

          const roundUpToNearest = (presetInput.round_up_to_nearest && presetInput.round_up_to_nearest > 0)
            ? presetInput.round_up_to_nearest
            : (preset.round_up_to_nearest && preset.round_up_to_nearest > 0)
              ? preset.round_up_to_nearest
              : 15;

          typeConfig = {
            hourly_rate: undefined, // No rate from preset
            minimum_billable_time: minBillableTime,
            round_up_to_nearest: roundUpToNearest,
          };
        } else if (preset.contract_line_type === 'Usage') {
          typeConfig = {
            unit_of_measure: presetService.unit_of_measure || 'unit',
            base_rate: undefined, // No rate from preset
            enable_tiered_pricing: false,
            minimum_usage: undefined,
          };
        }

        await planServiceConfigService.createConfiguration(baseConfig, typeConfig);
      }

      // Copy type-specific config for Fixed presets
      if (preset.contract_line_type === 'Fixed') {
        const presetFixedConfig = await trx('contract_line_preset_fixed_config')
          .where({ tenant, preset_id: preset.preset_id })
          .first();

        if (presetFixedConfig) {
          const fixedConfigModel = new ContractLineFixedConfig(trx, tenant);
          await fixedConfigModel.upsert({
            contract_line_id: contractLineId,
            base_rate: presetFixedConfig.base_rate,
            enable_proration: presetFixedConfig.enable_proration,
            billing_cycle_alignment: presetFixedConfig.billing_cycle_alignment,
            tenant,
          });
        }
      }

      // Record the mapping to the template
      await recordTemplateMapping(contractLineId);
    }

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

      await trx('contract_line_mappings').insert({
        tenant,
        contract_id: contractId,
        contract_line_id: planId,
        display_order: nextDisplayOrder,
        custom_rate: null,
        created_at: now.toISOString(),
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

      await trx('contract_line_mappings').insert({
        tenant,
        contract_id: contractId,
        contract_line_id: hourlyPlanId,
        display_order: nextDisplayOrder,
        custom_rate: null,
        created_at: now.toISOString(),
      });
      nextDisplayOrder += 1;
    }

    if (filteredUsageServices.length > 0) {
      const createdUsageLine = await ContractLine.create(trx, {
        contract_line_name: `${submission.contract_name} - Usage`,
        billing_frequency: submission.usage_billing_frequency ?? submission.billing_frequency ?? 'monthly',
        is_custom: true,
        service_category: null as any,
        contract_line_type: 'Usage',
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

      await trx('contract_line_mappings').insert({
        tenant,
        contract_id: contractId,
        contract_line_id: usagePlanId,
        display_order: nextDisplayOrder,
        custom_rate: null,
        created_at: now.toISOString(),
      });
      nextDisplayOrder += 1;
    }

    await trx('client_contracts').insert({
      tenant,
      client_contract_id: uuidv4(),
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

    return {
      contract_id: contractId,
      contract_line_id: primaryContractLineId,
      contract_line_ids: createdContractLineIds,
    };
  });
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

  const detailedLines = await ContractLineMapping.getDetailedContractLines(templateId);

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
      const fixedConfig = await knex('contract_template_line_fixed_config')
        .where({ tenant, template_line_id: line.contract_line_id })
        .first();
      if (fixedConfig) {
        const baseRateValue =
          fixedConfig.base_rate != null ? Number(fixedConfig.base_rate) : undefined;
        fixedBaseRateCents = baseRateValue != null ? Math.round(baseRateValue * 100) : undefined;
        enableProration = Boolean(fixedConfig.enable_proration);
      }

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
