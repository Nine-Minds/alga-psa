/**
 * Copying a contract line preset into a contract line, on a caller-owned
 * transaction. It lives outside the action module so a flow that must write the
 * contract header, its preset lines and the client assignment atomically (the
 * quick-add contract save) commits them together; the standalone server action
 * `copyPresetToContractLine` owns its own transaction and the permission check.
 */

import { resolveUnitOfMeasure } from '@alga-psa/core/unitOfMeasure';
import { tenantDb } from '@alga-psa/db';
import { Knex } from 'knex';
import {
    CadenceOwner,
    IContractLine,
    IContractLineFixedConfig,
    IContractLineServiceConfiguration,
    IUser,
} from '@alga-psa/types';
import { resolveRecurringAuthoringPolicy } from '@shared/billingClients/recurringAuthoringPolicy';

import ContractLine from '../models/contractLine';
import ContractLineFixedConfig from '../models/contractLineFixedConfig';
import ContractLinePreset from '../models/contractLinePreset';
import ContractLinePresetFixedConfig from '../models/contractLinePresetFixedConfig';
import ContractLinePresetService from '../models/contractLinePresetService';
import { upsertBucketOverlayInTransaction } from '../actions/bucketOverlayActions';
import { syncRecurringServicePeriodsForContractLine } from '../actions/recurringServicePeriodSync';
import { copyPresetPrepaidBlockToLine } from './prepaidBlockConfigService';
import { syncPrepaidBlockIssuancesForContractLine } from './prepaidBlockIssuanceSync';
import { ContractLineServiceConfigurationService } from './contractLineServiceConfigurationService';
import { getAnalyticsAsync } from '../lib/authHelpers';
import { hasBundleFixedService, isUnitFixedService } from '../lib/fixedServiceBasis';
import { normalizeContractLineDate, validateContractLineWindow } from '../lib/billing/contractLineWindow';

export class ContractLinePresetDomainError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ContractLinePresetDomainError';
    }
}

/**
 * Recurring rates are never negative. A negative fixed rate is not a discount
 * (credits are authored as configured discounts or manual invoice adjustments),
 * so it is rejected here before it can reach a stored charge and silently get
 * zero tax and no discount-base inclusion.
 */
export function assertNonNegativeRate(value: number | string | null | undefined, label: string): void {
    if (value === null || value === undefined) return;
    const numericValue = typeof value === 'string' && value.trim() === '' ? Number.NaN : Number(value);
    if (!Number.isFinite(numericValue) || numericValue < 0) {
        throw new ContractLinePresetDomainError(`${label} must be zero or greater.`);
    }
}

/** Per-contract overrides applied while copying a preset into a contract line. */
export type ContractLinePresetCopyOverrides = {
    base_rate?: number | null;
    services?: Record<string, { custom_rate?: number }>;
    minimum_billable_time?: number;
    round_up_to_nearest?: number;
    cadence_owner?: CadenceOwner;
    invoice_line_description?: string | null;
    start_date?: string | null;
    end_date?: string | null;
};

/**
 * The preset copy itself, on a caller-owned transaction, so a flow that must
 * also write the contract header and its client assignment atomically (the
 * quick-add contract save) commits the lines with them instead of leaving a
 * half-built contract behind. Authorization and error mapping belong to the
 * caller; `copyPresetToContractLine` (contractLinePresetActions) is the
 * standalone action wrapper.
 */
export async function copyPresetToContractLineInTransaction(
    trx: Knex.Transaction,
    user: IUser,
    tenantId: string,
    contractId: string,
    presetId: string,
    overrides?: ContractLinePresetCopyOverrides
): Promise<string> {
    // Recurring rates come from overrides, preset services and the preset
    // fixed config; reject a negative value at any of those sources.
    assertNonNegativeRate(overrides?.base_rate, 'Base rate');
    if (overrides?.services) {
        for (const override of Object.values(overrides.services)) {
            assertNonNegativeRate(override?.custom_rate, 'Service rate');
        }
    }
    const overrideWindowError = await validateContractLineWindow(trx, tenantId, contractId, {
        start_date: overrides?.start_date,
        end_date: overrides?.end_date,
    });
    if (overrideWindowError) {
        throw new ContractLinePresetDomainError(overrideWindowError);
    }

    // 1. Fetch the preset
    const preset = await ContractLinePreset.findById(trx, tenantId, presetId);
    if (!preset) {
        throw new ContractLinePresetDomainError(`Contract line preset ${presetId} not found`);
    }
    console.log(`[copyPresetToContractLine] Preset data:`, {
        preset_id: preset.preset_id,
        preset_name: preset.preset_name,
        minimum_billable_time: preset.minimum_billable_time,
        round_up_to_nearest: preset.round_up_to_nearest,
        overrides: overrides
    });

    const presetFixedConfig =
        preset.contract_line_type === 'Fixed'
            ? await ContractLinePresetFixedConfig.getByPresetId(trx, presetId)
            : null;
    const recurringAuthoringPolicy = resolveRecurringAuthoringPolicy({
        lineType: preset.contract_line_type ?? null,
        cadenceOwner: overrides?.cadence_owner ?? preset.cadence_owner,
        // The preset's timing is a stored value being copied, not a user choice:
        // a stale advance on an Hourly/Usage preset normalizes to arrears.
        fallbackBillingTiming: preset.billing_timing,
        enableProration: presetFixedConfig?.enable_proration,
        billingCycleAlignment: presetFixedConfig?.billing_cycle_alignment,
    });

    // 2. Create the contract line
    // Use override if provided, otherwise use preset value, otherwise use default
    const minBillableTime = overrides?.minimum_billable_time !== undefined
        ? overrides.minimum_billable_time
        : preset.minimum_billable_time !== undefined && preset.minimum_billable_time !== null
            ? preset.minimum_billable_time
            : 15;

    const roundUpToNearest = overrides?.round_up_to_nearest !== undefined
        ? overrides.round_up_to_nearest
        : preset.round_up_to_nearest !== undefined && preset.round_up_to_nearest !== null
            ? preset.round_up_to_nearest
            : 15;

    const contractLineData: Omit<IContractLine, 'contract_line_id' | 'tenant' | 'created_at' | 'updated_at'> = {
        contract_line_name: preset.preset_name,
        contract_line_type: preset.contract_line_type,
        billing_frequency: preset.billing_frequency,
        billing_timing: recurringAuthoringPolicy.billingTiming,
        cadence_owner: recurringAuthoringPolicy.cadenceOwner,
        service_category: undefined, // Presets don't have service_category
        is_custom: false, // Contract lines created from presets are not custom
        // Add hourly-specific fields if this is an hourly contract line
        ...(preset.contract_line_type === 'Hourly' ? {
            minimum_billable_time: minBillableTime,
            round_up_to_nearest: roundUpToNearest,
        } : {}),
    };
    const contractLine = await ContractLine.create(trx, contractLineData);

    if (!contractLine.contract_line_id) {
        throw new ContractLinePresetDomainError('Contract line creation completed without returning a contract_line_id.');
    }

    const contractLineId = contractLine.contract_line_id;

    // 3. Link the contract line to the contract by updating contract_lines directly
    // After migration 20251028090000, data is stored directly in contract_lines
    const countResult = await tenantDb(trx, tenantId).table('contract_lines')
        .where({ contract_id: contractId })
        .count<{ count: string | number }>('contract_line_id as count')
        .first();

    const existingCount =
        countResult?.count != null
            ? typeof countResult.count === 'string'
                ? Number.parseInt(countResult.count, 10)
                : Number(countResult.count)
            : 0;

    await tenantDb(trx, tenantId).table('contract_lines')
        .where({ contract_line_id: contractLineId })
        .update({
            contract_id: contractId,
            display_order: existingCount,
            custom_rate: null,
            invoice_line_description: overrides?.invoice_line_description?.trim() || null,
            start_date: normalizeContractLineDate(overrides?.start_date),
            end_date: normalizeContractLineDate(overrides?.end_date),
            updated_at: trx.fn.now()
        });

    // 4. Copy services and their configurations
    const presetServices = await ContractLinePresetService.getByPresetId(trx, presetId);
    console.log(`[copyPresetToContractLine] Found ${presetServices.length} services for preset ${presetId}:`, presetServices);

    if (presetServices.length > 0) {
        const configService = new ContractLineServiceConfigurationService(trx, tenantId);

        for (const presetService of presetServices) {
            const serviceOverride = overrides?.services?.[presetService.service_id];
            assertNonNegativeRate(serviceOverride?.custom_rate ?? presetService.custom_rate, 'Service rate');
            console.log(`[copyPresetToContractLine] Copying service ${presetService.service_id}, override:`, serviceOverride);

            // Insert into contract_line_services table
            await tenantDb(trx, tenantId).table('contract_line_services').insert({
                contract_line_id: contractLineId,
                service_id: presetService.service_id,
                tenant: tenantId
            });

            console.log(`[copyPresetToContractLine] Successfully inserted service ${presetService.service_id} for contract line ${contractLineId}`);

            // Determine configuration type based on contract line type
            let configurationType: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket' = preset.contract_line_type as any;

            // A per-seat Fixed service keeps its unit rate in the fixed config (below),
            // never in the service's allocation custom_rate. An empty preset rate
            // stays empty so the line follows the catalog in the contract currency.
            const isUnitPresetService =
                preset.contract_line_type === 'Fixed' && isUnitFixedService(presetService);
            const presetUnitRate = isUnitPresetService
                ? serviceOverride?.custom_rate ?? presetService.custom_rate ?? null
                : null;

            // Create the base configuration.
            // Usage billing is record-driven: a configured quantity is never a billing
            // input, so new Usage configurations are created without one.
            const baseConfig: Omit<IContractLineServiceConfiguration, 'config_id' | 'created_at' | 'updated_at'> = {
                contract_line_id: contractLineId,
                service_id: presetService.service_id,
                configuration_type: configurationType,
                custom_rate: isUnitPresetService
                    ? undefined
                    : serviceOverride?.custom_rate ?? presetService.custom_rate ?? undefined,
                quantity: configurationType === 'Usage'
                    ? undefined
                    : presetService.quantity ?? 1,
                instance_name: undefined,
                tenant: tenantId
            };

            // Create type-specific config based on contract line type
            let typeConfig: any = {};

            if (configurationType === 'Hourly') {
                // Use override if provided, otherwise use preset value, otherwise use default of 15
                const minBillableTime = overrides?.minimum_billable_time !== undefined
                    ? overrides.minimum_billable_time
                    : preset.minimum_billable_time !== undefined && preset.minimum_billable_time !== null
                        ? preset.minimum_billable_time
                        : 15;

                const roundUpToNearest = overrides?.round_up_to_nearest !== undefined
                    ? overrides.round_up_to_nearest
                    : preset.round_up_to_nearest !== undefined && preset.round_up_to_nearest !== null
                        ? preset.round_up_to_nearest
                        : 15;

                typeConfig = {
                    hourly_rate: baseConfig.custom_rate,
                    minimum_billable_time: minBillableTime,
                    round_up_to_nearest: roundUpToNearest
                };
            } else if (configurationType === 'Usage') {
                typeConfig = {
                    unit_of_measure: presetService.unit_of_measure || resolveUnitOfMeasure({ fallback: 'C62' }).label,
                    base_rate: baseConfig.custom_rate,
                    enable_tiered_pricing: false,
                    minimum_usage: undefined
                };
            } else if (isUnitPresetService) {
                typeConfig = {
                    pricing_basis: 'unit',
                    base_rate: presetUnitRate,
                    base_rate_basis: presetUnitRate == null ? undefined : 'per_unit',
                };
            }

            // Create the configuration record
            await configService.createConfiguration(baseConfig, typeConfig);

            console.log(`[copyPresetToContractLine] Successfully created configuration for service ${presetService.service_id}`);

            // Handle bucket overlay if present
            if (presetService.bucket_total_minutes != null && presetService.bucket_overage_rate != null) {
                console.log(`[copyPresetToContractLine] Creating bucket overlay for service ${presetService.service_id}`);

                // Route through the compat layer so the overlay is
                // created as the single-member 1x pool for this
                // (line, service) under the weighted-burn model.
                await upsertBucketOverlayInTransaction(
                    trx,
                    tenantId,
                    user,
                    contractLineId,
                    presetService.service_id,
                    {
                        total_minutes: Math.max(0, Math.round(presetService.bucket_total_minutes)),
                        overage_rate: Math.max(0, Math.round(presetService.bucket_overage_rate)),
                        allow_rollover: presetService.bucket_allow_rollover ?? false,
                        billing_period: (contractLine.billing_frequency as 'weekly' | 'monthly') ?? 'monthly',
                    },
                    null,
                    null,
                );

                console.log(`[copyPresetToContractLine] Successfully created bucket configuration for service ${presetService.service_id}`);
            }
        }
    } else {
        console.log(`[copyPresetToContractLine] No services found for preset ${presetId}, skipping service copy`);
    }

    // 5. Copy type-specific config
    if (preset.contract_line_type === 'Fixed') {
        if (presetFixedConfig) {
            // The line base rate is the bundle total for allocation members only. A
            // preset whose every service is a per-seat unit has no bundle, so a stale
            // base rate must not be billed on top of quantity x unit rate.
            const presetHasBundleService =
                presetServices.length === 0 || hasBundleFixedService(presetServices);
            const fixedConfigData: Omit<IContractLineFixedConfig, 'created_at' | 'updated_at'> = {
                contract_line_id: contractLineId,
                base_rate: !presetHasBundleService
                    ? null
                    : overrides?.base_rate !== undefined ? overrides.base_rate : presetFixedConfig.base_rate,
                enable_proration: recurringAuthoringPolicy.enableProration,
                billing_cycle_alignment: recurringAuthoringPolicy.billingCycleAlignment,
                tenant: tenantId
            };
            const fixedConfigModel = new ContractLineFixedConfig(trx, tenantId);
            await fixedConfigModel.upsert(fixedConfigData);
        }
    }

    // Track analytics
    const { analytics, AnalyticsEvents } = await getAnalyticsAsync();
    analytics.capture(AnalyticsEvents.BILLING_RULE_CREATED, {
        contract_line_id: contractLineId,
        contract_line_name: contractLine.contract_line_name,
        contract_line_type: contractLine.contract_line_type,
        copied_from_preset: presetId,
        contract_id: contractId
    }, user.user_id);

    // Presets with a contract_line_preset_prepaid_blocks row produce a Prepaid Block line.
    if (preset.contract_line_type === 'Hourly') {
        await copyPresetPrepaidBlockToLine(trx, tenantId, presetId, contractLineId);
    }

    // LEVERAGE: pattern line-obligation-sync — prepaid block issuances follow the same line-obligation changes as recurring service periods
    await syncRecurringServicePeriodsForContractLine(trx, {
        tenant: tenantId,
        contractLineId,
        sourceRunPrefix: 'contract_line_preset_copy',
    });
    await syncPrepaidBlockIssuancesForContractLine(trx, tenantId, contractLineId);

    return contractLineId;
}

