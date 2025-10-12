'use server';

import { withTransaction } from '@alga-psa/shared/db';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import BillingPlanFixedConfig from 'server/src/lib/models/billingPlanFixedConfig';
import { PlanServiceConfigurationService } from 'server/src/lib/services/planServiceConfigurationService';

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
  bundle_id: string;
  plan_id?: string;
  plan_ids?: string[];
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
    const bundleId = uuidv4();

    await trx('plan_bundles').insert({
      tenant,
      bundle_id: bundleId,
      bundle_name: submission.contract_name,
      bundle_description: submission.description ?? null,
      is_active: true,
      created_at: now,
      updated_at: now,
    });

    let createdPlanId: string | undefined;

    const filteredFixedServices = (submission.fixed_services || []).filter(
      (service) => service?.service_id
    );
    const filteredHourlyServices = (submission.hourly_services || []).filter(
      (service) => service?.service_id
    );

    const createdPlanIds: string[] = [];
    let primaryPlanId: string | undefined;
    let nextDisplayOrder = 0;

    if (filteredFixedServices.length > 0) {
      const planId = uuidv4();
      createdPlanIds.push(planId);
      if (!primaryPlanId) {
        primaryPlanId = planId;
      }
      createdPlanId = planId;

      await trx('billing_plans').insert({
        tenant,
        plan_id: planId,
        plan_name: `${submission.contract_name} - Fixed Fee`,
        description: submission.description ?? null,
        billing_frequency: 'monthly',
        is_custom: true,
        plan_type: 'Fixed',
      });

      const planFixedConfigModel = new BillingPlanFixedConfig(trx, tenant);
      const baseRateDollars = submission.fixed_base_rate
        ? submission.fixed_base_rate / 100
        : 0;

      await planFixedConfigModel.upsert({
        plan_id: planId,
        base_rate: baseRateDollars,
        enable_proration: submission.enable_proration,
        billing_cycle_alignment: submission.enable_proration ? 'prorated' : 'start',
        tenant,
      });

      const totalQuantity =
        filteredFixedServices.reduce((sum, svc) => sum + (svc.quantity ?? 1), 0) ||
        filteredFixedServices.length;
      let allocated = 0;

      for (const [index, service] of filteredFixedServices.entries()) {
        const quantity = service.quantity ?? 1;
        await trx('plan_services').insert({
          tenant,
          plan_id: planId,
          service_id: service.service_id,
          quantity,
          custom_rate: null,
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

        const configId = uuidv4();
        await trx('plan_service_configuration').insert({
          config_id: configId,
          plan_id: planId,
          service_id: service.service_id,
          configuration_type: 'Fixed',
          custom_rate: null,
          quantity,
          tenant,
          created_at: now,
          updated_at: now,
        });

        await trx('plan_service_fixed_config').insert({
          config_id: configId,
          base_rate: serviceBaseRate,
          tenant,
          created_at: now,
          updated_at: now,
        });
      }

      await trx('bundle_billing_plans').insert({
        tenant,
        bundle_id: bundleId,
        plan_id: planId,
        display_order: nextDisplayOrder++,
        created_at: now,
      });
    }

    const planServiceConfigService = new PlanServiceConfigurationService(trx, tenant);

    if (filteredHourlyServices.length > 0) {
      const hourlyPlanId = uuidv4();
      createdPlanIds.push(hourlyPlanId);
      if (!primaryPlanId) {
        primaryPlanId = hourlyPlanId;
      }

      await trx('billing_plans').insert({
        tenant,
        plan_id: hourlyPlanId,
        plan_name: `${submission.contract_name} - Hourly`,
        description: submission.description ?? null,
        billing_frequency: 'monthly',
        is_custom: true,
        plan_type: 'Hourly',
      });

      const minimumBillable = submission.minimum_billable_time ?? 0;
      const roundUp = submission.round_up_to_nearest ?? 0;

      for (const service of filteredHourlyServices) {
        await trx('plan_services').insert({
          tenant,
          plan_id: hourlyPlanId,
          service_id: service.service_id,
          quantity: 1,
          custom_rate: null,
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

      await trx('bundle_billing_plans').insert({
        tenant,
        bundle_id: bundleId,
        plan_id: hourlyPlanId,
        display_order: nextDisplayOrder++,
        created_at: now,
      });
    }

    // Bucket plan (hours or usage)
    const hasBucketServices = (submission.bucket_services || []).filter(s => s?.service_id).length > 0;
    const hasBucketConfig = submission.bucket_type && submission.bucket_overage_rate;
    if (hasBucketServices && hasBucketConfig) {
      const bucketPlanId = uuidv4();
      createdPlanIds.push(bucketPlanId);
      if (!primaryPlanId) {
        primaryPlanId = bucketPlanId;
      }

      await trx('billing_plans').insert({
        tenant,
        plan_id: bucketPlanId,
        plan_name: `${submission.contract_name} - Bucket`,
        description: submission.description ?? null,
        billing_frequency: 'monthly',
        is_custom: true,
        plan_type: 'Bucket',
      });

      // Add selected services to bucket plan and configure bucket specifics
      const totalQuantity = submission.bucket_type === 'hours'
        ? (submission.bucket_hours ?? 0) * 60 // minutes
        : (submission.bucket_usage_units ?? 0); // for usage, store units in total_minutes column as generic quantity

      for (const service of (submission.bucket_services || []).filter(s => s?.service_id)) {
        await trx('plan_services').insert({
          tenant,
          plan_id: bucketPlanId,
          service_id: service.service_id,
          quantity: null,
          custom_rate: null,
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

      await trx('bundle_billing_plans').insert({
        tenant,
        bundle_id: bundleId,
        plan_id: bucketPlanId,
        display_order: nextDisplayOrder++,
        created_at: now,
      });
    }

    // Assign bundle to client (company tables have been replaced by client tables)
    await trx('client_plan_bundles').insert({
      client_bundle_id: uuidv4(),
      tenant,
      client_id: submission.company_id,
      bundle_id: bundleId,
      start_date: normalizeDateOnly(submission.start_date),
      end_date: normalizeDateOnly(submission.end_date) ?? null,
      is_active: true,
      po_number: submission.po_number ?? null,
      po_amount: submission.po_amount ?? null,
      po_required: submission.po_required ?? false,
      created_at: now,
      updated_at: now,
    });

    return {
      bundle_id: bundleId,
      plan_id: primaryPlanId,
      plan_ids: createdPlanIds,
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
