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
  hourly_rate?: number; // cents
  bucket_overlay?: BucketOverlayInput | null;
};

type UsageServiceInput = {
  service_id: string;
  service_name?: string;
  unit_rate?: number;
  unit_of_measure?: string;
  bucket_overlay?: BucketOverlayInput | null;
};

export type ContractWizardSubmission = {
  contract_name: string;
  description?: string;
  company_id: string;
  start_date: string;
  end_date?: string;
  po_required?: boolean;
  po_number?: string;
  po_amount?: number;
  fixed_base_rate?: number; // cents
  enable_proration: boolean;
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

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

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

function normalizeDateOnly(input?: string): string | undefined {
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
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });

    let createdPlanId: string | undefined;

    const filteredFixedServices = (submission.fixed_services || []).filter(
      (service) => service?.service_id
    );
    const filteredHourlyServices = (submission.hourly_services || []).filter(
      (service) => service?.service_id
    );

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
      createdPlanId = planId;

      // Upsert fixed config (plan-level)
      const planFixedConfigModel = new ContractLineFixedConfig(trx, tenant);
      const baseRateDollars = submission.fixed_base_rate
        ? submission.fixed_base_rate / 100
        : 0;

      await planFixedConfigModel.upsert({
        contract_line_id: planId,
        base_rate: baseRateDollars,
        enable_proration: submission.enable_proration,
        billing_cycle_alignment: submission.enable_proration ? 'prorated' : 'start',
        tenant: tenant,
      });

      const totalQuantity =
        filteredFixedServices.reduce((sum, svc) => sum + (svc.quantity ?? 1), 0) ||
        filteredFixedServices.length;
      let allocated = 0;

      for (const [index, service] of filteredFixedServices.entries()) {
        const quantity = service.quantity ?? 1;
        // Link service to contract line
        await trx('contract_line_services').insert({
          tenant,
          contract_line_id: planId,
          service_id: service.service_id,
        });

        let serviceBaseRate = 0;
        if (baseRateDollars > 0) {
          const share = quantity / totalQuantity;
          const provisionalValue = baseRateDollars * share;

          if (index === filteredFixedServices.length - 1) {
            serviceBaseRate = roundToTwo(baseRateDollars - allocated);
          } else {
            serviceBaseRate = roundToTwo(provisionalValue);
            allocated = roundToTwo(allocated + serviceBaseRate);
          }
        }

        // Create configuration + fixed type details
        await planServiceConfigService.createConfiguration(
          {
            contract_line_id: planId,
            service_id: service.service_id,
            configuration_type: 'Fixed',
            quantity,
            tenant,
            custom_rate: undefined,
          },
          { base_rate: serviceBaseRate }
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
            hourly_rate: service.hourly_rate ?? 0,
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
    const startDate = normalizeDateOnly(submission.start_date);
    if (!startDate) {
      throw new Error('Contract start date is required');
    }

    const endDate = normalizeDateOnly(submission.end_date) ?? null;

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
    });

    return {
      contract_id: contractId,
      contract_line_id: primaryContractLineId,
      contract_line_ids: createdContractLineIds,
    };
  });
}
