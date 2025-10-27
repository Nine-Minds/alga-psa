'use server';

import { revalidatePath } from 'next/cache';
import {
    CreateAssetRequest,
    UpdateAssetRequest,
    AssetQueryParams,
    CreateAssetAssociationRequest,
    CreateMaintenanceScheduleRequest,
    UpdateMaintenanceScheduleRequest,
    CreateMaintenanceHistoryRequest,
    Asset,
    AssetListResponse,
    AssetAssociation,
    AssetMaintenanceSchedule,
    AssetMaintenanceHistory,
    AssetMaintenanceReport,
    ClientMaintenanceSummary,
    WorkstationAsset,
    NetworkDeviceAsset,
    ServerAsset,
    MobileDeviceAsset,
    PrinterAsset,
    isWorkstationAsset,
    isNetworkDeviceAsset,
    isServerAsset,
    isMobileDeviceAsset,
    isPrinterAsset
} from '@server/interfaces/asset.interfaces';
import { validateData } from '@server/lib/utils/validation';
import {
    assetSchema,
    assetAssociationSchema,
    createAssetSchema,
    createAssetAssociationSchema,
    updateAssetSchema,
    assetQuerySchema,
    assetMaintenanceScheduleSchema,
    createMaintenanceScheduleSchema,
    updateMaintenanceScheduleSchema,
    assetMaintenanceHistorySchema,
    createMaintenanceHistorySchema,
    assetMaintenanceReportSchema,
    clientMaintenanceSummarySchema
} from '@server/lib/schemas/asset.schema';
import { getCurrentUser } from '@product/actions/user-actions/userActions';
import { hasPermission } from '@server/lib/auth/rbac';
import { createTenantKnex } from '@server/lib/db';
import { Knex } from 'knex';
import { withTransaction } from '@shared/db';

type AssetExtensionType = WorkstationAsset | NetworkDeviceAsset | ServerAsset | MobileDeviceAsset | PrinterAsset;

// Helper function to get extension table data
async function getExtensionData(knex: Knex, tenant: string, asset_id: string, asset_type: string | undefined): Promise<AssetExtensionType | null> {
    if (!asset_type) return null;
    
    switch (asset_type.toLowerCase()) {
        case 'workstation':
            return knex('workstation_assets')
                .where({ tenant, asset_id })
                .first() as Promise<WorkstationAsset>;
        case 'network_device':
            return knex('network_device_assets')
                .where({ tenant, asset_id })
                .first() as Promise<NetworkDeviceAsset>;
        case 'server':
            return knex('server_assets')
                .where({ tenant, asset_id })
                .first() as Promise<ServerAsset>;
        case 'mobile_device':
            return knex('mobile_device_assets')
                .where({ tenant, asset_id })
                .first() as Promise<MobileDeviceAsset>;
        case 'printer':
            return knex('printer_assets')
                .where({ tenant, asset_id })
                .first() as Promise<PrinterAsset>;
        default:
            return null;
    }
}

// Helper function to validate extension data based on type
function validateExtensionData(data: unknown, type: string | undefined): AssetExtensionType | null {
    if (!data || typeof data !== 'object' || !type) return null;

    switch (type.toLowerCase()) {
        case 'workstation':
            if (isWorkstationAsset(data)) return data;
            break;
        case 'network_device':
            if (isNetworkDeviceAsset(data)) return data;
            break;
        case 'server':
            if (isServerAsset(data)) return data;
            break;
        case 'mobile_device':
            if (isMobileDeviceAsset(data)) return data;
            break;
        case 'printer':
            if (isPrinterAsset(data)) return data;
            break;
    }
    return null;
}

// Helper function to insert/update extension table data
async function upsertExtensionData(
    knex: Knex,
    tenant: string,
    asset_id: string,
    asset_type: string | undefined,
    data: unknown
): Promise<void> {
    if (!asset_type) return;
    
    const validatedData = validateExtensionData(data, asset_type);
    if (!validatedData) return;

    const table = `${asset_type.toLowerCase()}_assets`;
    // Remove tenant and asset_id from validatedData to avoid duplicate properties
    const { tenant: _t, asset_id: _a, ...extensionFields } = validatedData;
    const extensionData = { tenant, asset_id, ...extensionFields };

    // Check if record exists
    const exists = await knex(table)
        .where({ tenant, asset_id })
        .first();

    if (exists) {
        await knex(table)
            .where({ tenant, asset_id })
            .update(extensionData);
    } else {
        await knex(table).insert(extensionData);
    }
}

// Export getAsset for external use
export async function getAsset(asset_id: string): Promise<Asset> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }

    // Check permission for asset reading
    if (!await hasPermission(currentUser, 'asset', 'read')) {
        throw new Error('Permission denied: Cannot read assets');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
        throw new Error('No tenant found');
    }
    return getAssetWithExtensions(knex, tenant, asset_id);
}

function formatAssetForOutput(asset: any): Asset {
    // Format base asset data
    const formattedAsset = {
        ...asset,
        // Format dates
        created_at: typeof asset.created_at === 'string'
            ? asset.created_at
            : new Date(asset.created_at).toISOString(),
        updated_at: typeof asset.updated_at === 'string'
            ? asset.updated_at
            : new Date(asset.updated_at).toISOString(),
        purchase_date: asset.purchase_date
            ? new Date(asset.purchase_date).toISOString()
            : undefined,
        warranty_end_date: asset.warranty_end_date
            ? new Date(asset.warranty_end_date).toISOString()
            : undefined,
        // Handle optional fields
        serial_number: asset.serial_number || undefined,
        location: asset.location || undefined,
        // Ensure client data is properly structured
        client: asset.client ? {
            client_id: asset.client.client_id,
            client_name: asset.client.client_name || ''
        } : undefined,
        // Ensure relationships is always an array
        relationships: Array.isArray(asset.relationships) ? asset.relationships : [],

        // Format extension data based on asset type
        ...(asset.workstation && {
            workstation: {
                ...asset.workstation,
                gpu_model: asset.workstation.gpu_model || undefined,
                last_login: asset.workstation.last_login
                    ? new Date(asset.workstation.last_login).toISOString()
                    : undefined,
                installed_software: Array.isArray(asset.workstation.installed_software)
                    ? asset.workstation.installed_software
                    : []
            }
        }),

        ...(asset.network_device && {
            network_device: {
                ...asset.network_device,
                vlan_config: asset.network_device.vlan_config || {},
                port_config: asset.network_device.port_config || {}
            }
        }),

        ...(asset.server && {
            server: {
                ...asset.server,
                storage_config: Array.isArray(asset.server.storage_config)
                    ? asset.server.storage_config
                    : [],
                network_interfaces: Array.isArray(asset.server.network_interfaces)
                    ? asset.server.network_interfaces
                    : [],
                installed_services: Array.isArray(asset.server.installed_services)
                    ? asset.server.installed_services
                    : [],
                raid_config: asset.server.raid_config || undefined,
                hypervisor: asset.server.hypervisor || undefined,
                primary_ip: asset.server.primary_ip || undefined
            }
        }),

        ...(asset.mobile_device && {
            mobile_device: {
                ...asset.mobile_device,
                imei: asset.mobile_device.imei || undefined,
                phone_number: asset.mobile_device.phone_number || undefined,
                carrier: asset.mobile_device.carrier || undefined,
                last_check_in: asset.mobile_device.last_check_in
                    ? new Date(asset.mobile_device.last_check_in).toISOString()
                    : undefined,
                installed_apps: Array.isArray(asset.mobile_device.installed_apps)
                    ? asset.mobile_device.installed_apps
                    : []
            }
        }),

        ...(asset.printer && {
            printer: {
                ...asset.printer,
                ip_address: asset.printer.ip_address || undefined,
                max_paper_size: asset.printer.max_paper_size || undefined,
                monthly_duty_cycle: asset.printer.monthly_duty_cycle || undefined,
                supported_paper_types: Array.isArray(asset.printer.supported_paper_types)
                    ? asset.printer.supported_paper_types
                    : [],
                supply_levels: asset.printer.supply_levels || {}
            }
        })
    };

    return formattedAsset;
}

export async function createAsset(data: CreateAssetRequest): Promise<Asset> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }

    // Check permission for asset creation
    if (!await hasPermission(currentUser, 'asset', 'create')) {
        throw new Error('Permission denied: Cannot create assets');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
        throw new Error('No tenant found');
    }

    try {
        // Validate input data first
        try {
            validateData(createAssetSchema, data);
        } catch (error) {
            console.error('Input validation error:', error);
            throw new Error('Invalid input data: ' + (error instanceof Error ? error.message : 'Unknown error'));
        }

        // Start transaction
        const result = await knex.transaction(async (trx: Knex.Transaction) => {
            // Validate the input data
            const validatedData = validateData(createAssetSchema, data);

            const now = new Date().toISOString();

            // Extract only the base asset fields and ensure dates are only included if they exist
            const baseAssetData = {
                tenant,
                asset_type: validatedData.asset_type,
                client_id: validatedData.client_id,
                asset_tag: validatedData.asset_tag,
                name: validatedData.name,
                status: validatedData.status,
                location: validatedData.location || '',
                serial_number: validatedData.serial_number || '',
                created_at: now,
                updated_at: now,
                // Only include dates if they exist
                ...(validatedData.purchase_date && {
                    purchase_date: validatedData.purchase_date
                }),
                ...(validatedData.warranty_end_date && {
                    warranty_end_date: validatedData.warranty_end_date
                })
            };

            // Create base asset
            const [asset] = await trx('assets')
                .insert(baseAssetData)
                .returning('*');

            // Handle extension table data based on asset type
            const extensionData = data[data.asset_type as keyof CreateAssetRequest];
            if (extensionData) {
                await upsertExtensionData(trx, tenant, asset.asset_id, data.asset_type, extensionData);
            }

            const currentUser = await getCurrentUser();
            if (!currentUser) {
                throw new Error('No user session found');
            }

            // Create history record
            await trx('asset_history').insert({
                tenant,
                asset_id: asset.asset_id,
                changed_by: currentUser.user_id,
                change_type: 'created',
                changes: validatedData,
                changed_at: now
            });

            // Get complete asset data including extension table data
            const completeAsset = await getAssetWithExtensions(trx, tenant, asset.asset_id);
            
            // Format the asset data properly before returning
            return formatAssetForOutput(completeAsset);
        });

        // Validate the formatted output
        try {
            return validateData(assetSchema, result);
        } catch (error) {
            console.error('Output validation error:', error);
            throw new Error('Server error: Invalid output data format');
        }

    } catch (error) {
        console.error('Error creating asset:', error);
        if (error instanceof Error) {
            throw error; // Preserve the original error message
        }
        throw new Error('Failed to create asset');
    }
}

export async function updateAsset(asset_id: string, data: UpdateAssetRequest): Promise<Asset> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }

    // Check permission for asset updating
    if (!await hasPermission(currentUser, 'asset', 'update')) {
        throw new Error('Permission denied: Cannot update assets');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
        throw new Error('No tenant found');
    }

    try {
        const result = await knex.transaction(async (trx: Knex.Transaction) => {
            // Validate the update data
            const validatedData = validateData(updateAssetSchema, data);

            // Get current asset
            const asset = await trx('assets')
                .where({ tenant, asset_id })
                .first();

            if (!asset) {
                throw new Error('Asset not found');
            }

            // Update base asset
            const [updatedBaseAsset] = await trx('assets')
                .where({ tenant, asset_id })
                .update({
                    ...validatedData,
                    updated_at: knex.fn.now()
                })
                .returning('*');

            // Handle extension table data
            if (validatedData.asset_type) {
                const extensionData = data[validatedData.asset_type as keyof UpdateAssetRequest];
                if (extensionData) {
                    await upsertExtensionData(trx, tenant, asset_id, validatedData.asset_type, extensionData);
                }
            }

            const currentUser = await getCurrentUser();
            if (!currentUser) {
                throw new Error('No user session found');
            }

            // Create history record
            await trx('asset_history').insert({
                tenant,
                asset_id,
                changed_by: currentUser.user_id,
                change_type: 'updated',
                changes: validatedData,
                changed_at: knex.fn.now()
            });

            // Get complete asset data including extension table data
            const completeAsset = await getAssetWithExtensions(trx, tenant, asset_id);

            // Format dates for validation
            const formattedAsset = {
                ...completeAsset,
                created_at: typeof completeAsset.created_at === 'string'
                    ? completeAsset.created_at
                    : new Date(completeAsset.created_at).toISOString(),
                updated_at: typeof completeAsset.updated_at === 'string'
                    ? completeAsset.updated_at
                    : new Date(completeAsset.updated_at).toISOString(),
                purchase_date: completeAsset.purchase_date || '',
                warranty_end_date: completeAsset.warranty_end_date || '',
                relationships: completeAsset.relationships || []  // Ensure relationships is always an array
            };

            return formattedAsset;
        });

        revalidatePath('/assets');
        revalidatePath(`/assets/${asset_id}`);
        return validateData(assetSchema, result);
    } catch (error) {
        console.error('Error updating asset:', error);
        throw new Error('Failed to update asset');
    }
}

async function getAssetWithExtensions(knex: Knex, tenant: string, asset_id: string): Promise<Asset> {
    // Get base asset data with client info
    const asset = await knex('assets')
        .select(
            'assets.*',
            'clients.client_name'
        )
        .leftJoin('clients', function(this: Knex.JoinClause) {
            this.on('clients.client_id', '=', 'assets.client_id')
                .andOn('clients.tenant', '=', 'assets.tenant');
        })
        .where({ 'assets.tenant': tenant, 'assets.asset_id': asset_id })
        .first();

    if (!asset) {
        throw new Error('Asset not found');
    }

    // Get extension table data if applicable
    const extensionData = await getExtensionData(knex, tenant, asset_id, asset.asset_type);

    // Get relationships
    const relationships = await knex('asset_relationships')
        .where(function(this: Knex.QueryBuilder) {
            this.where('parent_asset_id', asset_id)
                .orWhere('child_asset_id', asset_id);
        })
        .andWhere({ tenant });

    // Transform the data
    const transformedAsset: Asset = {
        ...asset,
        client: {
            client_id: asset.client_id,
            client_name: asset.client_name || ''
        },
        relationships: relationships || [],  // Ensure relationships is always an array
        // Add extension data under the appropriate key
        ...(extensionData ? {
            [asset.asset_type]: extensionData
        } : {})
    };

    return transformedAsset;
}

export async function listAssets(params: AssetQueryParams): Promise<AssetListResponse> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }

    // Check permission for asset reading
    if (!await hasPermission(currentUser, 'asset', 'read')) {
        throw new Error('Permission denied: Cannot read assets');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
        throw new Error('No tenant found');
    }

    try {
        // Validate query parameters
        const validatedParams = validateData(assetQuerySchema, params);

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            // Build base query
            const baseQuery = trx('assets')
            .where('assets.tenant', tenant)
            .leftJoin('clients', function(this: Knex.JoinClause) {
                this.on('clients.client_id', '=', 'assets.client_id')
                    .andOn('clients.tenant', '=', 'assets.tenant')
                    .andOn('clients.tenant', '=', trx.raw('?', [tenant]));
            });

        // Apply filters
        if (validatedParams.client_id) {
            baseQuery.where('assets.client_id', validatedParams.client_id);
        }
        if (validatedParams.asset_type) {
            baseQuery.where('assets.asset_type', validatedParams.asset_type);
        }
        if (validatedParams.status) {
            baseQuery.where('assets.status', validatedParams.status);
        }

        // Get total count
        const [{ count }] = await baseQuery.clone().count('* as count');

        // Get paginated results
        const page = validatedParams.page || 1;
        const limit = validatedParams.limit || 10;
        const offset = (page - 1) * limit;

        const assets = await baseQuery
            .select(
                'assets.*',
                'clients.client_name'
            )
            .orderBy('assets.created_at', 'desc')
            .limit(limit)
            .offset(offset);

        // Get extension data for each asset if requested
        const assetsWithExtensions = await Promise.all(
            assets.map(async (asset: any): Promise<Asset> => {
                const extensionData = validatedParams.include_extension_data
                    ? await getExtensionData(trx, tenant, asset.asset_id, asset.asset_type)
                    : null;

                return {
                    ...asset,
                    client: {
                        client_id: asset.client_id,
                        client_name: asset.client_name || ''
                    },
                    relationships: [],  // Initialize empty array for relationships
                    ...(extensionData ? {
                        [asset.asset_type]: extensionData
                    } : {})
                };
            })
        );

            const response = {
                assets: assetsWithExtensions,
                total: Number(count),
                page,
                limit
            };

            return response;
        });
    } catch (error) {
        console.error('Error listing assets:', error);
        throw new Error('Failed to list assets');
    }
}

// Maintenance Schedule Management
export async function createMaintenanceSchedule(data: CreateMaintenanceScheduleRequest): Promise<AssetMaintenanceSchedule> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error('No user session found');
        }

        // Check permission for asset updating (maintenance is considered an update operation)
        if (!await hasPermission(currentUser, 'asset', 'update')) {
            throw new Error('Permission denied: Cannot create maintenance schedules');
        }

        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('No tenant found');
        }

        // Validate the input data
        const validatedData = validateData(createMaintenanceScheduleSchema, data);

        // Insert the schedule
        const [schedule] = await knex('asset_maintenance_schedules')
            .insert({
                tenant,
                asset_id: validatedData.asset_id,
                schedule_name: validatedData.schedule_name,
                description: validatedData.description,
                maintenance_type: validatedData.maintenance_type,
                frequency: validatedData.frequency,
                frequency_interval: validatedData.frequency_interval,
                schedule_config: validatedData.schedule_config,
                next_maintenance: validatedData.next_maintenance,
                created_by: currentUser.user_id
            })
            .returning('*');

        // Create initial notification
        await knex('asset_maintenance_notifications')
            .insert({
                tenant,
                schedule_id: schedule.schedule_id,
                asset_id: schedule.asset_id,
                notification_type: 'upcoming',
                notification_date: schedule.next_maintenance,
                notification_data: {
                    schedule_name: schedule.schedule_name,
                    maintenance_type: schedule.maintenance_type
                }
            });

        revalidatePath('/assets');
        revalidatePath(`/assets/${data.asset_id}`);

        return validateData(assetMaintenanceScheduleSchema, schedule);
    } catch (error) {
        console.error('Error creating maintenance schedule:', error);
        throw new Error('Failed to create maintenance schedule');
    }
}

export async function updateMaintenanceSchedule(
    schedule_id: string,
    data: UpdateMaintenanceScheduleRequest
): Promise<AssetMaintenanceSchedule> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        // Check permission for asset updating (maintenance is considered an update operation)
        if (!await hasPermission(currentUser, 'asset', 'update')) {
            throw new Error('Permission denied: Cannot update maintenance schedules');
        }

        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('No tenant found');
        }

        // Validate the update data
        const validatedData = validateData(updateMaintenanceScheduleSchema, data);

        // Update the schedule
        const [schedule] = await knex('asset_maintenance_schedules')
            .where({ tenant, schedule_id })
            .update({
                ...validatedData,
                updated_at: knex.fn.now()
            })
            .returning('*');

        // Update notifications if next_maintenance changed
        if (validatedData.next_maintenance) {
            await knex('asset_maintenance_notifications')
                .where({
                    tenant,
                    schedule_id,
                    is_sent: false
                })
                .update({
                    notification_date: validatedData.next_maintenance,
                    notification_data: knex.raw(`
                        jsonb_set(
                            notification_data,
                            '{schedule_name}',
                            ?::jsonb
                        )
                    `, [JSON.stringify(validatedData.schedule_name || schedule.schedule_name)])
                });
        }

        revalidatePath('/assets');
        revalidatePath(`/assets/${schedule.asset_id}`);

        return validateData(assetMaintenanceScheduleSchema, schedule);
    } catch (error) {
        console.error('Error updating maintenance schedule:', error);
        throw new Error('Failed to update maintenance schedule');
    }
}

export async function deleteMaintenanceSchedule(schedule_id: string): Promise<void> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        // Check permission for asset deletion
        if (!await hasPermission(currentUser, 'asset', 'delete')) {
            throw new Error('Permission denied: Cannot delete maintenance schedules');
        }

        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('No tenant found');
        }

        const [schedule] = await withTransaction(knex, async (trx: Knex.Transaction) => {
            return await trx('asset_maintenance_schedules')
                .where({ tenant, schedule_id })
                .delete()
                .returning(['asset_id']);
        });

        revalidatePath('/assets');
        if (schedule) {
            revalidatePath(`/assets/${schedule.asset_id}`);
        }
    } catch (error) {
        console.error('Error deleting maintenance schedule:', error);
        throw new Error('Failed to delete maintenance schedule');
    }
}

export async function recordMaintenanceHistory(data: CreateMaintenanceHistoryRequest): Promise<AssetMaintenanceHistory> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error('No user session found');
        }

        // Check permission for asset updating (maintenance recording is considered an update operation)
        if (!await hasPermission(currentUser, 'asset', 'update')) {
            throw new Error('Permission denied: Cannot record maintenance history');
        }

        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('No tenant found');
        }

        // Validate the input data
        const validatedData = validateData(createMaintenanceHistorySchema, data);

        // Record the maintenance history
        const [history] = await knex('asset_maintenance_history')
            .insert({
                tenant,
                ...validatedData,
                performed_by: currentUser.user_id
            })
            .returning('*');

        // Update the schedule's last maintenance date and calculate next maintenance
        const [schedule] = await knex('asset_maintenance_schedules')
            .where({
                tenant,
                schedule_id: validatedData.schedule_id
            })
            .update({
                last_maintenance: validatedData.performed_at,
                next_maintenance: knex.raw(`
                    CASE frequency
                        WHEN 'daily' THEN ? + INTERVAL '1 day' * frequency_interval
                        WHEN 'weekly' THEN ? + INTERVAL '1 week' * frequency_interval
                        WHEN 'monthly' THEN ? + INTERVAL '1 month' * frequency_interval
                        WHEN 'quarterly' THEN ? + INTERVAL '3 months' * frequency_interval
                        WHEN 'yearly' THEN ? + INTERVAL '1 year' * frequency_interval
                        ELSE ? + INTERVAL '1 day' * frequency_interval
                    END
                `, Array(6).fill(validatedData.performed_at))
            })
            .returning('*');

        // Create next notification
        await knex('asset_maintenance_notifications')
            .insert({
                tenant,
                schedule_id: schedule.schedule_id,
                asset_id: schedule.asset_id,
                notification_type: 'upcoming',
                notification_date: schedule.next_maintenance,
                notification_data: {
                    schedule_name: schedule.schedule_name,
                    maintenance_type: schedule.maintenance_type
                }
            });

        revalidatePath('/assets');
        revalidatePath(`/assets/${data.asset_id}`);

        return validateData(assetMaintenanceHistorySchema, history);
    } catch (error) {
        console.error('Error recording maintenance history:', error);
        throw new Error('Failed to record maintenance history');
    }
}

// Reporting Functions
export async function getAssetMaintenanceReport(asset_id: string): Promise<AssetMaintenanceReport> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        // Check permission for asset reading
        if (!await hasPermission(currentUser, 'asset', 'read')) {
            throw new Error('Permission denied: Cannot read asset maintenance reports');
        }

        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('No tenant found');
        }

        // Get asset details
        const asset = await knex('assets')
            .where({ tenant, asset_id })
            .first();

        if (!asset) {
            throw new Error('Asset not found');
        }

        // Get maintenance statistics with proper date handling
        const stats = await knex('asset_maintenance_schedules')
            .where({ tenant, asset_id })
            .select(
                knex.raw('COUNT(*) as total_schedules'),
                knex.raw('SUM(CASE WHEN is_active THEN 1 ELSE 0 END) as active_schedules'),
                knex.raw(`
                    TO_CHAR(MAX(last_maintenance), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as last_maintenance
                `),
                knex.raw(`
                    TO_CHAR(MIN(next_maintenance), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as next_maintenance
                `)
            )
            .first();

        // Get maintenance history
        const history = await knex('asset_maintenance_history')
            .where({ tenant, asset_id })
            .orderBy('performed_at', 'desc');

        // Calculate compliance rate
        const completed = await knex('asset_maintenance_history')
            .where({ tenant, asset_id })
            .count('* as count')
            .first();

        const scheduled = await knex('asset_maintenance_schedules')
            .where({ tenant, asset_id })
            .sum('frequency_interval as sum')
            .first();

        const completedCount = completed?.count ? Number(completed.count) : 0;
        const scheduledSum = scheduled?.sum ? Number(scheduled.sum) : 0;
        const compliance_rate = scheduledSum > 0 ? (completedCount / scheduledSum) * 100 : 100;

        // Get upcoming maintenance count
        const upcomingCount = await knex('asset_maintenance_notifications')
            .where({ tenant, asset_id, is_sent: false })
            .count('* as count')
            .first()
            .then(result => Number(result?.count || 0));

        const report = {
            asset_id,
            asset_name: asset.name,
            total_schedules: Number(stats?.total_schedules || 0),
            active_schedules: Number(stats?.active_schedules || 0),
            completed_maintenances: completedCount,
            upcoming_maintenances: upcomingCount,
            last_maintenance: stats?.last_maintenance || undefined,
            next_maintenance: stats?.next_maintenance || undefined,
            compliance_rate,
            maintenance_history: history.map((record): AssetMaintenanceHistory => ({
                ...record,
                performed_at: typeof record.performed_at === 'string'
                    ? record.performed_at
                    : new Date(record.performed_at).toISOString()
            }))
        };

        return validateData(assetMaintenanceReportSchema, report);
    } catch (error) {
        console.error('Error getting asset maintenance report:', error);
        throw new Error('Failed to get asset maintenance report');
    }
}

export async function getClientMaintenanceSummary(client_id: string): Promise<ClientMaintenanceSummary> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        // Check permission for asset reading
        if (!await hasPermission(currentUser, 'asset', 'read')) {
            throw new Error('Permission denied: Cannot read client maintenance summaries');
        }

        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('No tenant found');
        }

        // Get client details
        const client = await knex('clients')
            .where({ tenant, client_id })
            .first();

        if (!client) {
            throw new Error('Client not found');
        }

        // Get asset statistics with proper 'this' type annotation
        const assetStats = await knex('assets')
            .where({ 'assets.tenant': tenant, client_id })
            .select(
                knex.raw('COUNT(DISTINCT assets.asset_id) as total_assets'),
                knex.raw(`
                    COUNT(DISTINCT CASE 
                        WHEN asset_maintenance_schedules.asset_id IS NOT NULL 
                        THEN assets.asset_id 
                    END) as assets_with_maintenance
                `)
            )
            .leftJoin('asset_maintenance_schedules', function(this: Knex.JoinClause) {
                this.on('assets.asset_id', '=', 'asset_maintenance_schedules.asset_id')
                    .andOn('asset_maintenance_schedules.tenant', '=', knex.raw('?', [tenant]));
            })
            .first();

        // Get maintenance statistics with date conversion
        const maintenanceStats = await knex('asset_maintenance_schedules')
            .where({ 'asset_maintenance_schedules.tenant': tenant })
            .whereIn('asset_id',
                knex('assets')
                    .where({ 
                        'assets.tenant': tenant, 
                        client_id,
                        tenant 
                    })
                    .select('asset_id')
            )
            .select(
                knex.raw('COUNT(*) as total_schedules'),
                knex.raw(`
                    COUNT(CASE 
                        WHEN next_maintenance < NOW() AND is_active 
                        THEN 1 
                    END) as overdue_maintenances
                `),
                knex.raw(`
                    COUNT(CASE 
                        WHEN next_maintenance > NOW() AND is_active 
                        THEN 1 
                    END) as upcoming_maintenances
                `)
            )
            .first();

        // Get maintenance type breakdown
        const typeBreakdown = await knex('asset_maintenance_schedules')
            .where({ 'asset_maintenance_schedules.tenant': tenant })
            .whereIn('asset_id',
                knex('assets')
                    .where({ 
                        'assets.tenant': tenant, 
                        client_id,
                        tenant 
                    })
                    .select('asset_id')
            )
            .select('maintenance_type')
            .count('* as count')
            .groupBy('maintenance_type')
            .then(results =>
                results.reduce((acc, { maintenance_type, count }) => ({
                    ...acc,
                    [maintenance_type]: Number(count)
                }), {} as Record<string, number>)
            );

        // Calculate compliance rate
        const completed = await knex('asset_maintenance_history')
            .where({ 'asset_maintenance_history.tenant': tenant })
            .whereIn('asset_id',
                knex('assets')
                    .where({ 'assets.tenant': tenant, client_id })
                    .select('asset_id')
            )
            .count('* as count')
            .first();

        const scheduled = await knex('asset_maintenance_schedules')
            .where({ 'asset_maintenance_schedules.tenant': tenant })
            .whereIn('asset_id',
                knex('assets')
                    .where({ 'assets.tenant': tenant, client_id })
                    .select('asset_id')
            )
            .sum('frequency_interval as sum')
            .first();

        const completedCount = completed?.count ? Number(completed.count) : 0;
        const scheduledSum = scheduled?.sum ? Number(scheduled.sum) : 0;
        const compliance_rate = scheduledSum > 0 ? (completedCount / scheduledSum) * 100 : 100;

        // Create summary with proper date handling
        const summary = {
            client_id,
            client_name: client.client_name,
            total_assets: Number(assetStats?.total_assets || 0),
            assets_with_maintenance: Number(assetStats?.assets_with_maintenance || 0),
            total_schedules: Number(maintenanceStats?.total_schedules || 0),
            overdue_maintenances: Number(maintenanceStats?.overdue_maintenances || 0),
            upcoming_maintenances: Number(maintenanceStats?.upcoming_maintenances || 0),
            compliance_rate,
            maintenance_by_type: typeBreakdown || {}
        };

        // Validate and return the summary
        return validateData(clientMaintenanceSummarySchema, summary);
    } catch (error) {
        console.error('Error getting client maintenance summary:', error);
        throw new Error('Failed to get client maintenance summary');
    }
}

// Asset Association Functions
// Update only the map callback in listEntityAssets function
export async function listEntityAssets(entity_id: string, entity_type: 'ticket' | 'project'): Promise<Asset[]> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }

    // Check permission for asset reading
    if (!await hasPermission(currentUser, 'asset', 'read')) {
        throw new Error('Permission denied: Cannot read asset associations');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
        throw new Error('No tenant found');
    }

    try {
        // Get asset associations
        const associations = await knex('asset_associations')
            .where({
                tenant,
                entity_id,
                entity_type
            });

        // Add explicit return type to the map callback
        const assets = await Promise.all(
            associations.map(async (association): Promise<Asset> => 
                getAssetWithExtensions(knex, tenant, association.asset_id)
            )
        );

        return assets;
    } catch (error) {
        console.error('Error listing entity assets:', error);
        throw new Error('Failed to list entity assets');
    }
}

export async function createAssetAssociation(data: CreateAssetAssociationRequest): Promise<AssetAssociation> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No user session found');
    }

    // Check permission for asset updating (associations are considered update operations)
    if (!await hasPermission(currentUser, 'asset', 'update')) {
        throw new Error('Permission denied: Cannot create asset associations');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
        throw new Error('No tenant found');
    }

    try {

        // Validate the input data
        const validatedData = validateData(createAssetAssociationSchema, data);

        // Create the association
        const [association] = await knex('asset_associations')
            .insert({
                tenant,
                ...validatedData,
                created_by: currentUser.user_id,
                created_at: knex.fn.now()
            })
            .returning('*');

        // Revalidate paths
        revalidatePath('/assets');
        revalidatePath(`/assets/${data.asset_id}`);
        if (data.entity_type === 'ticket') {
            revalidatePath(`/tickets/${data.entity_id}`);
        } else {
            revalidatePath(`/projects/${data.entity_id}`);
        }

        return validateData(assetAssociationSchema, association);
    } catch (error) {
        console.error('Error creating asset association:', error);
        throw new Error('Failed to create asset association');
    }
}

export async function removeAssetAssociation(
    asset_id: string,
    entity_id: string,
    entity_type: 'ticket' | 'project'
): Promise<void> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }

    // Check permission for asset deletion
    if (!await hasPermission(currentUser, 'asset', 'delete')) {
        throw new Error('Permission denied: Cannot remove asset associations');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
        throw new Error('No tenant found');
    }

    try {
        await knex('asset_associations')
            .where({
                tenant,
                asset_id,
                entity_id,
                entity_type
            })
            .delete();

        // Revalidate paths
        revalidatePath('/assets');
        revalidatePath(`/assets/${asset_id}`);
        if (entity_type === 'ticket') {
            revalidatePath(`/tickets/${entity_id}`);
        } else {
            revalidatePath(`/projects/${entity_id}`);
        }
    } catch (error) {
        console.error('Error removing asset association:', error);
        throw new Error('Failed to remove asset association');
    }
}
