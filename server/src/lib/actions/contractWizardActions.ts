'use server';

import { withTransaction } from '@alga-psa/shared/db';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import ContractLineFixedConfig from 'server/src/lib/models/contractLineFixedConfig';
import ContractLine from 'server/src/lib/models/contractLine';
import { ContractLineServiceConfigurationService as ContractLineServiceConfigurationService } from 'server/src/lib/services/contractLineServiceConfigurationService';

type BucketOverlayInput = {
  total_minutes?: number;
  overage_rate?: number;
  allow_rollover?: boolean;
  billing_period?: 'monthly' | 'weekly';
};

type FixedServiceInput = {
  service_id: string;
  service_name?: string;
  quantity?: number;
  bucket_overlay?: BucketOverlayInput | null;
};

type HourlyServiceInput = {
  service_id: string;
  service_name?: string;
  bucket_overlay?: BucketOverlayInput | null;
};

type UsageServiceInput = {
  service_id: string;
  service_name?: string;
  unit_of_measure?: string;
  bucket_overlay?: BucketOverlayInput | null;
};

export type ContractWizardSubmission = {
  contract_name: string;
  description?: string;
  billing_frequency?: string;
  fixed_services: FixedServiceInput[];
  hourly_services?: HourlyServiceInput[];
  usage_services?: UsageServiceInput[];
  minimum_billable_time?: number;
  round_up_to_nearest?: number;
};

export type ContractWizardResult = {
  contract_id: string;
  contract_line_id?: string;
  contract_line_ids?: string[];
};

async function upsertBucketOverlay(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string,
  serviceId: string,
  overlay: BucketOverlayInput,
  quantity?: number | null,
  customRate?: number | null
) {
  if (overlay.total_minutes == null || overlay.overage_rate == null) {
    return;
  }

  const normalizedTotal = Math.max(0, Math.round(overlay.total_minutes));
  const normalizedOverage = Math.max(0, Math.round(overlay.overage_rate));
  const billingPeriod = overlay.billing_period ?? 'monthly';

  const existing = await trx('contract_line_service_configuration')
    .where({
      tenant,
      contract_line_id: contractLineId,
      service_id: serviceId,
      configuration_type: 'Bucket'
    })
    .first('config_id');

  const configId = existing?.config_id ?? uuidv4();

  await trx('contract_line_services')
    .insert({
      tenant,
      contract_line_id: contractLineId,
      service_id: serviceId,
      quantity: quantity ?? null,
      custom_rate: customRate ?? null
    })
    .onConflict(['tenant', 'contract_line_id', 'service_id'])
    .merge({
      quantity: quantity ?? null,
      custom_rate: customRate ?? null
    });

  await trx('contract_line_service_configuration')
    .insert({
      tenant,
      config_id: configId,
      contract_line_id: contractLineId,
      service_id: serviceId,
      configuration_type: 'Bucket',
      custom_rate: null,
      quantity: null
    })
    .onConflict(['tenant', 'config_id'])
    .merge({
      contract_line_id: contractLineId,
      service_id: serviceId,
      configuration_type: 'Bucket'
    });

  await trx('contract_line_service_bucket_config')
    .insert({
      tenant,
      config_id: configId,
      billing_period: billingPeriod,
      total_minutes: normalizedTotal,
      overage_rate: normalizedOverage,
      allow_rollover: overlay.allow_rollover ?? false
    })
    .onConflict(['tenant', 'config_id'])
    .merge({
      billing_period: billingPeriod,
      total_minutes: normalizedTotal,
      overage_rate: normalizedOverage,
      allow_rollover: overlay.allow_rollover ?? false
    });
}

export async function createContractFromWizard(
  submission: ContractWizardSubmission,
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
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });

    const filteredFixedServices = (submission.fixed_services || []).filter(
      (service) => service?.service_id
    );
    const filteredHourlyServices = (submission.hourly_services || []).filter(
      (service) => service?.service_id
    );
    const filteredUsageServices = (submission.usage_services || []).filter(
      (service) => service?.service_id
    );

    // Validate that all services match their contract line type
    const allServiceIds = [
      ...filteredFixedServices.map(s => s.service_id),
      ...filteredHourlyServices.map(s => s.service_id),
      ...filteredUsageServices.map(s => s.service_id)
    ];

    if (allServiceIds.length > 0) {
      const services = await trx('service_catalog')
        .whereIn('service_id', allServiceIds)
        .select('service_id', 'service_name', 'billing_method');

      // Validate fixed services
      for (const fixedService of filteredFixedServices) {
        const service = services.find(s => s.service_id === fixedService.service_id);
        if (service && service.billing_method !== 'fixed') {
          throw new Error(`Service "${service.service_name}" has billing method "${service.billing_method}" but can only be added to fixed fee contract lines`);
        }
      }

      // Validate hourly services
      for (const hourlyService of filteredHourlyServices) {
        const service = services.find(s => s.service_id === hourlyService.service_id);
        if (service && service.billing_method !== 'hourly') {
          throw new Error(`Service "${service.service_name}" has billing method "${service.billing_method}" but can only be added to hourly contract lines`);
        }
      }

      // Validate usage services
      for (const usageService of filteredUsageServices) {
        const service = services.find(s => s.service_id === usageService.service_id);
        if (service && service.billing_method !== 'usage') {
          throw new Error(`Service "${service.service_name}" has billing method "${service.billing_method}" but can only be added to usage-based contract lines`);
        }
      }
    }

    const createdContractLineIds: string[] = [];
    let primaryContractLineId: string | undefined;
    let nextDisplayOrder = 0;
    const planServiceConfigService = new ContractLineServiceConfigurationService(trx, tenant);

    if (filteredFixedServices.length > 0) {
      // Create a contract line (Fixed)
      const createdFixedLine = await ContractLine.create(trx, {
        contract_line_name: `${submission.contract_name} - Fixed Fee`,
        billing_frequency: 'monthly',
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
      // Persist plan-level defaults (pricing captured per client)
      const planFixedConfigModel = new ContractLineFixedConfig(trx, tenant);
      await planFixedConfigModel.upsert({
        contract_line_id: planId,
        base_rate: null,
        enable_proration: false,
        billing_cycle_alignment: 'start',
        tenant,
      });

      for (const service of filteredFixedServices) {
        const quantity = service.quantity ?? null;
        await trx('contract_line_services').insert({
          tenant,
          contract_line_id: planId,
          service_id: service.service_id,
        });

        await planServiceConfigService.createConfiguration(
          {
            contract_line_id: planId,
            service_id: service.service_id,
            configuration_type: 'Fixed',
            quantity,
            tenant,
            custom_rate: undefined,
          },
          { base_rate: null }
        );

        if (service.bucket_overlay) {
          await upsertBucketOverlay(
            trx,
            tenant,
            planId,
            service.service_id,
            service.bucket_overlay,
            quantity ?? null,
            null
          );
        }
      }
      // Map contract line to contract
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
        billing_frequency: 'monthly',
        is_custom: true,
        service_category: null as any,
        contract_line_type: 'Hourly',
      } as any);
      const hourlyPlanId = createdHourlyLine.contract_line_id!;
      createdContractLineIds.push(hourlyPlanId);
      if (!primaryContractLineId) {
        primaryContractLineId = hourlyPlanId;
      }

      const minimumBillable = submission.minimum_billable_time ?? 0;
      const roundUp = submission.round_up_to_nearest ?? 0;

      for (const service of filteredHourlyServices) {
        await trx('contract_line_services').insert({
          tenant,
          contract_line_id: hourlyPlanId,
          service_id: service.service_id,
        });
        await planServiceConfigService.upsertPlanServiceHourlyConfiguration(
          hourlyPlanId,
          service.service_id,
          {
            hourly_rate: 0,
            minimum_billable_time: minimumBillable,
            round_up_to_nearest: roundUp,
          }
        );

        if (service.bucket_overlay) {
          await upsertBucketOverlay(
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
        billing_frequency: 'monthly',
        is_custom: true,
        service_category: null as any,
        contract_line_type: 'Usage',
        hourly_rate: null,
        minimum_billable_time: null,
        round_up_to_nearest: null,
        enable_overtime: null,
        overtime_rate: null,
        overtime_threshold: null,
        enable_after_hours_rate: null,
        after_hours_multiplier: null,
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

        await planServiceConfigService.createConfiguration(
          {
            contract_line_id: usagePlanId,
            service_id: service.service_id,
            configuration_type: 'Usage',
            tenant,
            quantity: null,
            custom_rate: undefined,
          },
          {
            unit_of_measure: service.unit_of_measure ?? 'unit',
            enable_tiered_pricing: false,
            minimum_usage: null,
          }
        );

        if (service.bucket_overlay) {
          await upsertBucketOverlay(
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
    return {
      contract_id: contractId,
      contract_line_id: primaryContractLineId,
      contract_line_ids: createdContractLineIds,
    };
  });
}
