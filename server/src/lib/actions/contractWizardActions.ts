'use server';

import { withTransaction } from '@alga-psa/shared/db';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import ContractLineFixedConfig from 'server/src/lib/models/contractLineFixedConfig';
import ContractLine from 'server/src/lib/models/contractLine';
import ContractLineMapping from 'server/src/lib/models/contractLineMapping';
import ClientContract from 'server/src/lib/models/clientContract';
import { ContractLineServiceConfigurationService as ContractLineServiceConfigurationService } from 'server/src/lib/services/contractLineServiceConfigurationService';

type FixedServiceInput = {
  service_id: string;
  service_name?: string;
  quantity?: number;
};

type HourlyServiceInput = {
  service_id: string;
  service_name?: string;
  hourly_rate?: number; // cents
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
  minimum_billable_time?: number;
  round_up_to_nearest?: number;
  // Bucket services
  bucket_type?: 'hours' | 'usage';
  bucket_hours?: number; // for hours-type bucket
  bucket_usage_units?: number; // for usage-type bucket
  bucket_unit_of_measure?: string | undefined; // currently not persisted
  bucket_monthly_fee?: number; // cents, currently not persisted
  bucket_overage_rate?: number; // cents
  bucket_services?: Array<{ service_id: string; service_name?: string }>;
};

export type ContractWizardResult = {
  contract_id: string;
  contract_line_id?: string;
  contract_line_ids?: string[];
};

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function createContractFromWizard(
  submission: ContractWizardSubmission
): Promise<ContractWizardResult> {
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
      billing_frequency: 'monthly',
      is_active: true,
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
        const configService = new ContractLineServiceConfigurationService(trx, tenant);
        const configId = await configService.createConfiguration(
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
      }
      // Map contract line to contract
      await ContractLineMapping.addContractLine(contractId, planId, undefined);
      nextDisplayOrder++;
    }

    const planServiceConfigService = new ContractLineServiceConfigurationService(trx, tenant);

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
      }

      await ContractLineMapping.addContractLine(contractId, hourlyPlanId, undefined);
      nextDisplayOrder++;
    }

    // Bucket plan (hours or usage)
    const hasBucketServices = (submission.bucket_services || []).filter(s => s?.service_id).length > 0;
    const hasBucketConfig = submission.bucket_type && submission.bucket_overage_rate;
    if (hasBucketServices && hasBucketConfig) {
      const createdBucketLine = await ContractLine.create(trx, {
        contract_line_name: `${submission.contract_name} - Bucket`,
        billing_frequency: 'monthly',
        is_custom: true,
        service_category: null as any,
        contract_line_type: 'Bucket',
      } as any);
      const bucketPlanId = createdBucketLine.contract_line_id!;
      createdContractLineIds.push(bucketPlanId);
      if (!primaryContractLineId) {
        primaryContractLineId = bucketPlanId;
      }

      // Add selected services to bucket plan and configure bucket specifics
      const totalQuantity = submission.bucket_type === 'hours'
        ? (submission.bucket_hours ?? 0) * 60 // minutes
        : (submission.bucket_usage_units ?? 0); // for usage, store units in total_minutes column as generic quantity

      for (const service of (submission.bucket_services || []).filter(s => s?.service_id)) {
        await trx('contract_line_services').insert({
          tenant,
          contract_line_id: bucketPlanId,
          service_id: service.service_id,
        });

        await planServiceConfigService.upsertPlanServiceBucketConfiguration(
          bucketPlanId,
          service.service_id,
          {
            total_minutes: totalQuantity,
            billing_period: 'monthly',
            overage_rate: submission.bucket_overage_rate ?? 0,
            allow_rollover: false,
          }
        );
      }

      await ContractLineMapping.addContractLine(contractId, bucketPlanId, undefined);
      nextDisplayOrder++;
    }

    // Assign contract to client
    await ClientContract.assignContractToClient(
      submission.company_id,
      contractId,
      normalizeDateOnly(submission.start_date)!,
      normalizeDateOnly(submission.end_date) ?? null
    );

    return {
      contract_id: contractId,
      contract_line_id: primaryContractLineId,
      contract_line_ids: createdContractLineIds,
    };
  });
}
    // Normalize date-only fields to YYYY-MM-DD to avoid TZ shifts at DB layer
    const normalizeDateOnly = (input?: string): string | undefined => {
      if (!input) return undefined;
      const t = input.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t; // already Y-M-D
      if (t.includes('T')) return t.split('T')[0];
      const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // M/D/YYYY
      if (m) {
        const [, mmRaw, ddRaw, yyyy] = m;
        const mm = mmRaw.padStart(2, '0');
        const dd = ddRaw.padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
      }
      return t;
    };
