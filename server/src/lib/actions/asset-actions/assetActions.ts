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
    AssetHistory,
    AssetTicketSummary,
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
    isPrinterAsset,
    AssetSummaryMetrics,
    HealthStatus,
    SecurityStatus,
    WarrantyStatus,
} from '../../../interfaces/asset.interfaces';
import { IDocument } from '../../../interfaces/document.interface';
import { validateData } from '../../utils/validation';
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
} from '../../schemas/asset.schema';
import { getCurrentUser } from '../user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { createTenantKnex } from '../../db';
import { Knex } from 'knex';
import { withTransaction } from '@shared/db';

type AssetExtensionType = WorkstationAsset | NetworkDeviceAsset | ServerAsset | MobileDeviceAsset | PrinterAsset;

export interface AssetDetailBundle {
    asset: Asset;
    maintenanceReport: AssetMaintenanceReport;
    maintenanceHistory: AssetMaintenanceHistory[];
    history: AssetHistory[];
    tickets: AssetTicketSummary[];
    documents: IDocument[];
}

const normalizeNullableString = (value: string | null | undefined) => (value ?? undefined);

function pruneNullishValues(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value
            .map((item) => pruneNullishValues(item))
            .filter((item) => item !== undefined);
    }

    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [key, val]) => {
            const cleanedValue = pruneNullishValues(val);
            if (cleanedValue !== undefined) {
                acc[key] = cleanedValue;
            }
            return acc;
        }, {});

        return Object.keys(entries).length > 0 ? entries : undefined;
    }

    return value === null ? undefined : value;
}

function sanitizeUpdatePayload(data: UpdateAssetRequest): UpdateAssetRequest {
    const sanitized = {
        ...data,
        workstation: data.workstation ? (({ installed_software, last_login, gpu_model, ...rest }) => ({
            ...rest,
            last_login: normalizeNullableString(last_login),
            gpu_model: normalizeNullableString(gpu_model),
            installed_software: Array.isArray(installed_software) ? installed_software : []
        }))(data.workstation) : undefined,
        network_device: data.network_device ? (({ vlan_config, port_config, ...rest }) => ({
            ...rest,
            vlan_config: vlan_config || {},
            port_config: port_config || {}
        }))(data.network_device) : undefined,
        server: data.server ? (({
            storage_config,
            network_interfaces,
            installed_services,
            raid_config,
            hypervisor,
            primary_ip,
            ...rest
        }) => ({
            ...rest,
            raid_config: normalizeNullableString(raid_config),
            hypervisor: normalizeNullableString(hypervisor),
            primary_ip: normalizeNullableString(primary_ip),
            storage_config: Array.isArray(storage_config) ? storage_config : [],
            network_interfaces: Array.isArray(network_interfaces) ? network_interfaces : [],
            installed_services: Array.isArray(installed_services) ? installed_services : []
        }))(data.server) : undefined,
        mobile_device: data.mobile_device ? (({ installed_apps, carrier, phone_number, ...rest }) => ({
            ...rest,
            carrier: normalizeNullableString(carrier),
            phone_number: normalizeNullableString(phone_number),
            installed_apps: Array.isArray(installed_apps) ? installed_apps : []
        }))(data.mobile_device) : undefined,
        printer: data.printer ? (({ supported_paper_types, ip_address, ...rest }) => ({
            ...rest,
            ip_address: normalizeNullableString(ip_address),
            supported_paper_types: Array.isArray(supported_paper_types) ? supported_paper_types : [],
            supply_levels: rest.supply_levels || {}
        }))(data.printer) : undefined
    };

    return pruneNullishValues(sanitized) as UpdateAssetRequest;
}

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

async function deleteExtensionData(
    knex: Knex,
    tenant: string,
    asset_id: string,
    asset_type: string | undefined
): Promise<void> {
    if (!asset_type) {
        return;
    }

    const table = `${asset_type.toLowerCase()}_assets`;
    await knex(table)
        .where({ tenant, asset_id })
        .delete();
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

export async function getAssetDetailBundle(asset_id: string): Promise<AssetDetailBundle> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
        throw new Error('No tenant found');
    }

    if (!await hasPermission(currentUser, 'asset', 'read', knex)) {
        throw new Error('Permission denied: Cannot read assets');
    }

    const [assetRecord, canReadTickets, canReadDocuments] = await Promise.all([
        getAssetWithExtensions(knex, tenant, asset_id),
        hasPermission(currentUser, 'ticket', 'read', knex),
        hasPermission(currentUser, 'document', 'read', knex)
    ]);

    const formattedAsset = formatAssetForOutput(assetRecord);

    const [maintenanceReport, history, tickets, documents] = await Promise.all([
        fetchAssetMaintenanceReport(knex, tenant, asset_id),
        fetchAssetHistory(knex, tenant, asset_id),
        canReadTickets ? fetchAssetLinkedTickets(knex, tenant, asset_id) : Promise.resolve([]),
        canReadDocuments ? fetchAssetDocuments(knex, tenant, asset_id) : Promise.resolve([])
    ]);

    return {
        asset: formattedAsset,
        maintenanceReport,
        maintenanceHistory: maintenanceReport?.maintenance_history ?? [],
        history,
        tickets,
        documents
    };
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
            const normalizedData = sanitizeUpdatePayload(data);
            const validatedData = validateData(updateAssetSchema, normalizedData);
            const {
                workstation,
                network_device,
                server: serverExtension,
                mobile_device,
                printer,
                ...baseCandidate
            } = validatedData;

            const extensionPayloads = {
                workstation,
                network_device,
                server: serverExtension,
                mobile_device,
                printer
            };

            // Get current asset
            const asset = await trx('assets')
                .where({ tenant, asset_id })
                .first();

            if (!asset) {
                throw new Error('Asset not found');
            }

            // Update base asset fields (excluding extension payloads)
            const baseUpdateData: Record<string, unknown> = {};
            Object.entries(baseCandidate).forEach(([key, value]) => {
                if (value !== undefined) {
                    baseUpdateData[key] = value;
                }
            });

            if (Object.keys(baseUpdateData).length > 0) {
                baseUpdateData.updated_at = trx.fn.now();
                await trx('assets')
                    .where({ tenant, asset_id })
                    .update(baseUpdateData);
            } else {
                await trx('assets')
                    .where({ tenant, asset_id })
                    .update({ updated_at: trx.fn.now() });
            }

            const nextAssetType = (baseCandidate.asset_type as string | undefined) ?? asset.asset_type;

            if (baseCandidate.asset_type && baseCandidate.asset_type !== asset.asset_type) {
                await deleteExtensionData(trx, tenant, asset_id, asset.asset_type);
            }

            const extensionData = nextAssetType
                ? extensionPayloads[nextAssetType as keyof typeof extensionPayloads]
                : undefined;

            if (extensionData) {
                await upsertExtensionData(trx, tenant, asset_id, nextAssetType, extensionData);
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

            // Return normalized asset data for client consumption
            const completeAsset = await getAssetWithExtensions(trx, tenant, asset_id);
            return formatAssetForOutput(completeAsset);
        });

        revalidatePath('/assets');
        revalidatePath(`/assets/${asset_id}`);
        revalidatePath('/msp/assets');
        revalidatePath(`/msp/assets/${asset_id}`);
        return validateData(assetSchema, result);
    } catch (error) {
        console.error('Error updating asset:', error);
        throw new Error('Failed to update asset');
    }
}

export async function deleteAsset(asset_id: string): Promise<void> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }

    if (!await hasPermission(currentUser, 'asset', 'delete')) {
        throw new Error('Permission denied: Cannot delete assets');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
        throw new Error('No tenant found');
    }

    try {
        await knex.transaction(async (trx: Knex.Transaction) => {
            const asset = await trx('assets')
                .where({ tenant, asset_id })
                .first();

            if (!asset) {
                throw new Error('Asset not found');
            }

            await deleteExtensionData(trx, tenant, asset_id, asset.asset_type);

            await trx('asset_history').where({ tenant, asset_id }).delete();
            await trx('asset_maintenance_history').where({ tenant, asset_id }).delete();
            await trx('asset_maintenance_schedules').where({ tenant, asset_id }).delete();
            await trx('asset_relationships')
                .where({ tenant, parent_asset_id: asset_id })
                .orWhere({ tenant, child_asset_id: asset_id })
                .delete();
            await trx('asset_associations').where({ tenant, asset_id }).delete();
            await trx('document_associations')
                .where({ tenant, entity_type: 'asset', entity_id: asset_id })
                .delete();

            await trx('assets')
                .where({ tenant, asset_id })
                .delete();
        });

        revalidatePath('/assets');
        revalidatePath('/msp/assets');
        revalidatePath(`/assets/${asset_id}`);
        revalidatePath(`/msp/assets/${asset_id}`);
    } catch (error) {
        console.error('Error deleting asset:', error);
        throw new Error('Failed to delete asset');
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
        if (validatedParams.search) {
            const searchTerm = `%${validatedParams.search}%`;
            baseQuery.where(function() {
                this.whereILike('assets.name', searchTerm)
                    .orWhereILike('assets.asset_tag', searchTerm)
                    .orWhereILike('assets.serial_number', searchTerm);
            });
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

        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('No tenant found');
        }

        if (!await hasPermission(currentUser, 'asset', 'read', knex)) {
            throw new Error('Permission denied: Cannot read asset maintenance reports');
        }

        return await fetchAssetMaintenanceReport(knex, tenant, asset_id);
    } catch (error) {
        console.error('Error getting asset maintenance report:', error);
        throw new Error('Failed to get asset maintenance report');
    }
}

export async function getAssetHistory(asset_id: string): Promise<AssetHistory[]> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('No tenant found');
        }

        return await withTransaction(knex, async (trx: Knex.Transaction): Promise<AssetHistory[]> => {
            if (!await hasPermission(currentUser, 'asset', 'read', trx)) {
                throw new Error('Permission denied: Cannot read asset history');
            }

            return fetchAssetHistory(trx, tenant, asset_id);
        });
    } catch (error) {
        console.error('Error getting asset history:', error);
        throw new Error('Failed to get asset history');
    }
}

type RawLinkedTicket = {
    entity_id: string;
    relationship_type?: string | null;
    linked_at: string | Date;
    ticket_id: string | null;
    title: string | null;
    status_id: string | null;
    status_name: string | null;
    priority_id: string | null;
    priority_name: string | null;
    updated_at: string | Date | null;
    assigned_first_name?: string | null;
    assigned_last_name?: string | null;
    client_name?: string | null;
};

export async function getAssetLinkedTickets(asset_id: string): Promise<AssetTicketSummary[]> {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('No tenant found');
        }

        return await withTransaction(knex, async (trx: Knex.Transaction): Promise<AssetTicketSummary[]> => {
            if (!await hasPermission(currentUser, 'ticket', 'read', trx)) {
                throw new Error('Permission denied: Cannot read linked tickets');
            }

            return fetchAssetLinkedTickets(trx, tenant, asset_id);
        });
    } catch (error) {
        console.error('Error getting asset linked tickets:', error);
        throw new Error('Failed to get asset linked tickets');
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

        return await getClientMaintenanceSummaryForTenant(knex, tenant, client_id);
    } catch (error) {
        console.error('Error getting client maintenance summary:', error);
        throw new Error('Failed to get client maintenance summary');
    }
}

async function fetchAssetMaintenanceReport(
    db: Knex | Knex.Transaction,
    tenant: string,
    asset_id: string
): Promise<AssetMaintenanceReport> {
    const asset = await db('assets')
        .where({ tenant, asset_id })
        .first();

    if (!asset) {
        throw new Error('Asset not found');
    }

    const stats = await db('asset_maintenance_schedules')
        .where({ tenant, asset_id })
        .select(
            db.raw('COUNT(*) as total_schedules'),
            db.raw('SUM(CASE WHEN is_active THEN 1 ELSE 0 END) as active_schedules'),
            db.raw(`TO_CHAR(MAX(last_maintenance), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as last_maintenance`),
            db.raw(`TO_CHAR(MIN(next_maintenance), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as next_maintenance`)
        )
        .first();

    const history = await db('asset_maintenance_history')
        .where({ tenant, asset_id })
        .orderBy('performed_at', 'desc');

    const completed = await db('asset_maintenance_history')
        .where({ tenant, asset_id })
        .count('* as count')
        .first();

    const scheduled = await db('asset_maintenance_schedules')
        .where({ tenant, asset_id })
        .sum('frequency_interval as sum')
        .first();

    const upcomingCount = await db('asset_maintenance_notifications')
        .where({ tenant, asset_id, is_sent: false })
        .count('* as count')
        .first()
        .then(result => Number(result?.count || 0));

    const completedCount = completed?.count ? Number(completed.count) : 0;
    const scheduledSum = scheduled?.sum ? Number(scheduled.sum) : 0;
    const compliance_rate = scheduledSum > 0 ? (completedCount / scheduledSum) * 100 : 100;

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
                : new Date(record.performed_at).toISOString(),
            created_at: typeof record.created_at === 'string'
                ? record.created_at
                : record.created_at instanceof Date
                    ? record.created_at.toISOString()
                    : new Date(record.created_at).toISOString()
        }))
    };

    return validateData(assetMaintenanceReportSchema, report);
}

async function fetchAssetHistory(
    db: Knex | Knex.Transaction,
    tenant: string,
    asset_id: string
): Promise<AssetHistory[]> {
    const history = await db('asset_history')
        .where({ tenant, asset_id })
        .orderBy('changed_at', 'desc');

    return history.map((record): AssetHistory => ({
        ...record,
        changed_at: typeof record.changed_at === 'string'
            ? record.changed_at
            : new Date(record.changed_at).toISOString()
    }));
}

async function fetchAssetLinkedTickets(
    db: Knex | Knex.Transaction,
    tenant: string,
    asset_id: string
): Promise<AssetTicketSummary[]> {
    const rows = await db('asset_associations as aa')
        .leftJoin('tickets as t', function(this: Knex.JoinClause) {
            this.on('aa.entity_id', '=', 't.ticket_id')
                .andOn('aa.tenant', '=', 't.tenant');
        })
        .leftJoin('statuses as s', function(this: Knex.JoinClause) {
            this.on('t.status_id', '=', 's.status_id')
                .andOn('t.tenant', '=', 's.tenant');
        })
        .leftJoin('priorities as p', function(this: Knex.JoinClause) {
            this.on('t.priority_id', '=', 'p.priority_id')
                .andOn('t.tenant', '=', 'p.tenant');
        })
        .leftJoin('users as u', function(this: Knex.JoinClause) {
            this.on('t.assigned_to', '=', 'u.user_id')
                .andOn('t.tenant', '=', 'u.tenant');
        })
        .leftJoin('clients as c', function(this: Knex.JoinClause) {
            this.on('t.client_id', '=', 'c.client_id')
                .andOn('t.tenant', '=', 'c.tenant');
        })
        .where({
            'aa.tenant': tenant,
            'aa.asset_id': asset_id,
            'aa.entity_type': 'ticket'
        })
        .orderBy('aa.created_at', 'desc')
        .select<RawLinkedTicket[]>(
            'aa.entity_id',
            'aa.relationship_type',
            'aa.created_at as linked_at',
            't.ticket_id',
            't.title',
            't.status_id',
            's.name as status_name',
            't.priority_id',
            'p.priority_name',
            't.updated_at',
            'u.first_name as assigned_first_name',
            'u.last_name as assigned_last_name',
            'c.client_name'
        );

    return rows.map((row): AssetTicketSummary => {
        const ticketId = row.ticket_id || row.entity_id;
        const assigned_to_name = [row.assigned_first_name, row.assigned_last_name]
            .filter(Boolean)
            .join(' ')
            .trim();

        return {
            ticket_id: ticketId,
            title: row.title || 'Linked ticket unavailable',
            status_id: row.status_id || 'unknown',
            status_name: row.status_name || 'Unknown',
            priority_id: row.priority_id || undefined,
            priority_name: row.priority_name || undefined,
            linked_at: typeof row.linked_at === 'string'
                ? row.linked_at
                : row.linked_at.toISOString(),
            updated_at: row.updated_at
                ? (row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at)
                : undefined,
            client_name: row.client_name || undefined,
            assigned_to_name: assigned_to_name.length > 0 ? assigned_to_name : undefined,
            relationship_type: row.relationship_type || undefined
        };
    });
}

async function fetchAssetDocuments(
    db: Knex | Knex.Transaction,
    tenant: string,
    asset_id: string,
    limit = 15
): Promise<IDocument[]> {
    const records = await db('documents')
        .join('document_associations', function() {
            this.on('documents.document_id', '=', 'document_associations.document_id')
                .andOn('document_associations.tenant', '=', db.raw('?', [tenant]));
        })
        .leftJoin('users', function() {
            this.on('documents.created_by', '=', 'users.user_id')
                .andOn('users.tenant', '=', db.raw('?', [tenant]));
        })
        .where('documents.tenant', tenant)
        .where('document_associations.entity_id', asset_id)
        .andWhere('document_associations.entity_type', 'asset')
        .orderBy('documents.updated_at', 'desc')
        .limit(limit)
        .select(
            'documents.*',
            db.raw("CONCAT(users.first_name, ' ', users.last_name) as created_by_full_name")
        );

    return records.map((record) => ({
        document_id: record.document_id,
        document_name: record.document_name,
        type_id: record.type_id,
        shared_type_id: record.shared_type_id,
        user_id: record.created_by,
        order_number: record.order_number || 0,
        created_by: record.created_by,
        tenant: record.tenant,
        file_id: record.file_id,
        storage_path: record.storage_path,
        mime_type: record.mime_type,
        file_size: record.file_size,
        created_by_full_name: record.created_by_full_name,
        entered_at: record.entered_at,
        updated_at: record.updated_at
    }));
}

async function getClientMaintenanceSummaryForTenant(
    db: Knex | Knex.Transaction,
    tenant: string,
    client_id: string
): Promise<ClientMaintenanceSummary> {
    const client = await db('clients')
        .where({ tenant, client_id })
        .first();

    if (!client) {
        throw new Error('Client not found');
    }

    const assetStats = await db('assets')
        .where({ 'assets.tenant': tenant, client_id })
        .select(
            db.raw('COUNT(DISTINCT assets.asset_id) as total_assets'),
            db.raw(`
                COUNT(DISTINCT CASE 
                    WHEN asset_maintenance_schedules.asset_id IS NOT NULL 
                    THEN assets.asset_id 
                END) as assets_with_maintenance
            `)
        )
        .leftJoin('asset_maintenance_schedules', function(this: Knex.JoinClause) {
            this.on('assets.asset_id', '=', 'asset_maintenance_schedules.asset_id')
                .andOn('asset_maintenance_schedules.tenant', '=', db.raw('?', [tenant]));
        })
        .first();

    const assetIdsSubquery = db('assets')
        .where({ 'assets.tenant': tenant, client_id })
        .select('asset_id');

    const maintenanceStats = await db('asset_maintenance_schedules')
        .where({ 'asset_maintenance_schedules.tenant': tenant })
        .whereIn('asset_id', assetIdsSubquery)
        .select(
            db.raw('COUNT(*) as total_schedules'),
            db.raw(`
                COUNT(CASE 
                    WHEN next_maintenance < NOW() AND is_active 
                    THEN 1 
                END) as overdue_maintenances
            `),
            db.raw(`
                COUNT(CASE 
                    WHEN next_maintenance > NOW() AND is_active 
                    THEN 1 
                END) as upcoming_maintenances
            `)
        )
        .first();

    const typeBreakdown = await db('asset_maintenance_schedules')
        .where({ 'asset_maintenance_schedules.tenant': tenant })
        .whereIn('asset_id', assetIdsSubquery)
        .select('maintenance_type')
        .count('* as count')
        .groupBy('maintenance_type')
        .then(results =>
            results.reduce((acc, { maintenance_type, count }) => ({
                ...acc,
                [maintenance_type]: Number(count)
            }), {} as Record<string, number>)
        );

    const completed = await db('asset_maintenance_history')
        .where({ 'asset_maintenance_history.tenant': tenant })
        .whereIn('asset_id', assetIdsSubquery)
        .count('* as count')
        .first();

    const scheduled = await db('asset_maintenance_schedules')
        .where({ 'asset_maintenance_schedules.tenant': tenant })
        .whereIn('asset_id', assetIdsSubquery)
        .sum('frequency_interval as sum')
        .first();

    const completedCount = completed?.count ? Number(completed.count) : 0;
    const scheduledSum = scheduled?.sum ? Number(scheduled.sum) : 0;
    const compliance_rate = scheduledSum > 0 ? (completedCount / scheduledSum) * 100 : 100;

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

    return validateData(clientMaintenanceSummarySchema, summary);
}

export async function getClientMaintenanceSummaries(client_ids: string[]): Promise<Record<string, ClientMaintenanceSummary>> {
    try {
        if (client_ids.length === 0) {
            return {};
        }

        const currentUser = await getCurrentUser();
        if (!currentUser) {
            throw new Error('No authenticated user found');
        }

        if (!await hasPermission(currentUser, 'asset', 'read')) {
            throw new Error('Permission denied: Cannot read client maintenance summaries');
        }

        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('No tenant found');
        }

        const entries = await Promise.all(
            client_ids.map(async (clientId) => {
                try {
                    const summary = await getClientMaintenanceSummaryForTenant(knex, tenant, clientId);
                    return [clientId, summary] as const;
                } catch (error) {
                    console.error('Failed to load maintenance summary for client', clientId, error);
                    return null;
                }
            })
        );

        return entries.reduce<Record<string, ClientMaintenanceSummary>>((acc, entry) => {
            if (entry) {
                acc[entry[0]] = entry[1];
            }
            return acc;
        }, {});
    } catch (error) {
        console.error('Error getting client maintenance summaries:', error);
        throw new Error('Failed to get client maintenance summaries');
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

        // Convert Date to ISO string for schema validation
        const sanitizedAssociation = {
            ...association,
            created_at: association.created_at instanceof Date
                ? association.created_at.toISOString()
                : association.created_at
        };

        return validateData(assetAssociationSchema, sanitizedAssociation);
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

export async function getAssetSummaryMetrics(asset_id: string): Promise<AssetSummaryMetrics> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        throw new Error('No authenticated user found');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
        throw new Error('No tenant found');
    }

    try {
        // Get asset info
        const asset = await knex('assets')
            .where({ tenant, asset_id })
            .select(
                'asset_type',
                'agent_status',
                'last_seen_at',
                'warranty_end_date'
            )
            .first();

        if (!asset) {
            throw new Error('Asset not found');
        }

        // Calculate health status based on agent status and last seen time
        const { health_status, health_reason } = calculateHealthStatus(asset);

        // Count open tickets associated with this asset
        const ticketCountResult = await knex('asset_associations')
            .where('asset_associations.tenant', tenant)
            .where('asset_associations.asset_id', asset_id)
            .where('asset_associations.entity_type', 'ticket')
            .join('tickets', function() {
                this.on('tickets.tenant', '=', 'asset_associations.tenant')
                    .andOn('tickets.ticket_id', '=', 'asset_associations.entity_id');
            })
            .join('statuses', function() {
                this.on('statuses.tenant', '=', 'tickets.tenant')
                    .andOn('statuses.status_id', '=', 'tickets.status_id');
            })
            .where('statuses.is_closed', false)
            .count('* as count')
            .first();

        const open_tickets_count = parseInt(String(ticketCountResult?.count || 0), 10);

        // Calculate security status based on asset extension data
        const { security_status, security_issues } = await calculateSecurityStatus(
            knex,
            tenant,
            asset_id,
            asset.asset_type
        );

        // Calculate warranty status
        const { warranty_status, warranty_days_remaining } = calculateWarrantyStatus(
            asset.warranty_end_date
        );

        return {
            health_status,
            health_reason,
            open_tickets_count,
            security_status,
            security_issues,
            warranty_days_remaining,
            warranty_status,
        };
    } catch (error) {
        console.error('Error getting asset summary metrics:', error);
        throw new Error('Failed to get asset summary metrics');
    }
}

/**
 * Calculate health status based on agent status and last seen time
 */
function calculateHealthStatus(asset: {
    agent_status: string | null;
    last_seen_at: string | null;
}): { health_status: HealthStatus; health_reason: string | null } {
    // If no RMM data, return unknown
    if (!asset.agent_status) {
        return { health_status: 'unknown', health_reason: 'No RMM data available' };
    }

    // Check agent status
    if (asset.agent_status === 'offline') {
        // Check how long it's been offline
        if (asset.last_seen_at) {
            const lastSeen = new Date(asset.last_seen_at);
            const now = new Date();
            const hoursSinceLastSeen = (now.getTime() - lastSeen.getTime()) / (1000 * 60 * 60);

            if (hoursSinceLastSeen > 72) {
                return {
                    health_status: 'critical',
                    health_reason: `Device offline for ${Math.floor(hoursSinceLastSeen / 24)} days`,
                };
            } else if (hoursSinceLastSeen > 24) {
                return {
                    health_status: 'warning',
                    health_reason: `Device offline for ${Math.floor(hoursSinceLastSeen)} hours`,
                };
            }
        }
        return { health_status: 'warning', health_reason: 'Device offline' };
    }

    // Agent is online - consider healthy
    return { health_status: 'healthy', health_reason: null };
}

/**
 * Calculate security status based on antivirus and patch status
 */
async function calculateSecurityStatus(
    knex: Knex,
    tenant: string,
    assetId: string,
    assetType: string
): Promise<{ security_status: SecurityStatus; security_issues: string[] }> {
    const issues: string[] = [];

    // Get extension data based on asset type
    let extensionData: {
        antivirus_status?: string;
        antivirus_product?: string;
        pending_patches?: number;
        failed_patches?: number;
    } | null = null;

    if (assetType === 'workstation') {
        extensionData = await knex('workstation_assets')
            .where({ tenant, asset_id: assetId })
            .select('antivirus_status', 'antivirus_product', 'pending_patches', 'failed_patches')
            .first();
    } else if (assetType === 'server') {
        extensionData = await knex('server_assets')
            .where({ tenant, asset_id: assetId })
            .select('antivirus_status', 'antivirus_product', 'pending_patches', 'failed_patches')
            .first();
    }

    if (!extensionData) {
        return { security_status: 'secure', security_issues: [] };
    }

    // Check antivirus status
    if (extensionData.antivirus_status === 'at_risk') {
        issues.push('Antivirus protection at risk');
    } else if (!extensionData.antivirus_product) {
        issues.push('No antivirus detected');
    }

    // Check patch status
    if (extensionData.failed_patches && extensionData.failed_patches > 0) {
        issues.push(`${extensionData.failed_patches} failed patches`);
    }

    if (extensionData.pending_patches && extensionData.pending_patches > 10) {
        issues.push(`${extensionData.pending_patches} pending patches`);
    }

    // Determine security status based on issues
    let security_status: SecurityStatus = 'secure';
    if (issues.length > 0) {
        // Critical if AV is at risk or many failed patches
        if (
            extensionData.antivirus_status === 'at_risk' ||
            (extensionData.failed_patches && extensionData.failed_patches > 5)
        ) {
            security_status = 'critical';
        } else {
            security_status = 'at_risk';
        }
    }

    return { security_status, security_issues: issues };
}

/**
 * Calculate warranty status based on warranty end date
 */
function calculateWarrantyStatus(warrantyEndDate: string | null): {
    warranty_status: WarrantyStatus;
    warranty_days_remaining: number | null;
} {
    if (!warrantyEndDate) {
        return { warranty_status: 'unknown', warranty_days_remaining: null };
    }

    const endDate = new Date(warrantyEndDate);
    const now = new Date();
    const daysRemaining = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysRemaining < 0) {
        return { warranty_status: 'expired', warranty_days_remaining: daysRemaining };
    } else if (daysRemaining <= 90) {
        return { warranty_status: 'expiring_soon', warranty_days_remaining: daysRemaining };
    } else {
        return { warranty_status: 'active', warranty_days_remaining: daysRemaining };
    }
}
