import { AssetRelationshipModel } from './assetRelationship';
import { BaseModel } from './BaseModel';
import type { Knex } from 'knex';
import { 
    Asset, 
    AssetHistory, 
    AssetAssociation,
    CreateAssetRequest, 
    UpdateAssetRequest, 
    CreateAssetAssociationRequest,
    AssetQueryParams, 
    AssetListResponse,
    ClientMaintenanceSummary,
    MaintenanceType,
    WorkstationAsset,
    NetworkDeviceAsset,
    ServerAsset,
    MobileDeviceAsset,
    PrinterAsset
} from '../interfaces/asset.interfaces';

function convertDatesToISOString<T>(obj: T): T {
    if (obj === null || obj === undefined) {
        return obj;
    }

    if (obj instanceof Date) {
        return obj.toISOString() as unknown as T;
    }

    if (Array.isArray(obj)) {
        return obj.map((item): unknown => convertDatesToISOString(item)) as unknown as T;
    }

    if (typeof obj === 'object') {
        const converted: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
            converted[key] = convertDatesToISOString(value);
        }
        return converted as T;
    }

    return obj;
}

async function getExtensionData(
    knex: Knex,
    tenant: string,
    asset_id: string,
    asset_type: string
): Promise<WorkstationAsset | NetworkDeviceAsset | ServerAsset | MobileDeviceAsset | PrinterAsset | null> {
    switch (asset_type.toLowerCase()) {
        case 'workstation':
            return knex('workstation_assets')
                .where({ asset_id })
                .first();
        case 'network_device':
            return knex('network_device_assets')
                .where({ asset_id })
                .first();
        case 'server':
            return knex('server_assets')
                .where({ asset_id })
                .first();
        case 'mobile_device':
            return knex('mobile_device_assets')
                .where({ asset_id })
                .first();
        case 'printer':
            return knex('printer_assets')
                .where({ asset_id })
                .first();
        default:
            return null;
    }
}

async function upsertExtensionData(
    knex: Knex,
    tenant: string,
    asset_id: string,
    asset_type: string,
    data: any
): Promise<void> {
    if (!data) return;

    const table = `${asset_type.toLowerCase()}_assets`;
    const extensionData = { tenant, asset_id, ...data };

    const exists = await knex(table)
        .where({ asset_id })
        .first();

    if (exists) {
        await knex(table)
            .where({ asset_id })
            .update(extensionData);
    } else {
        await knex(table).insert(extensionData);
    }
}

export class AssetModel extends BaseModel {
    static async create(knexOrTrx: Knex | Knex.Transaction, data: CreateAssetRequest): Promise<Asset> {
        const tenant = await this.getTenant();
        if (!tenant) {
            throw new Error('No tenant found');
        }

        return knexOrTrx.transaction(async (trx) => {
            // Verify client exists and get full client details
            const client = await trx('clients')
                .select('*')
                .where({ tenant, client_id: data.client_id })
                .first();

            if (!client) {
                throw new Error('Client not found');
            }

            // Create base asset
            const [asset] = await trx('assets')
                .insert({
                    ...data,
                    tenant,
                })
                .returning('*');

            // Handle extension table data based on asset type
            const extensionData = data[data.asset_type as keyof CreateAssetRequest];
            if (extensionData) {
                await upsertExtensionData(trx, tenant, asset.asset_id, data.asset_type, extensionData);
            }

            // Get extension data
            const typeExtensionData = await getExtensionData(trx, tenant, asset.asset_id, data.asset_type);

            // Transform client data with location fields
            const transformedClient = {
                client_id: client.client_id,
                client_name: client.client_name,
                url: client.url ?? '',
                created_at: client.created_at ?? new Date().toISOString(),
                updated_at: client.updated_at ?? new Date().toISOString(),
                is_inactive: client.is_inactive ?? false,
                is_tax_exempt: client.is_tax_exempt ?? false,
                notes: client.notes ?? '',
                client_type: client.client_type,
                tax_id_number: client.tax_id_number,
                properties: client.properties,
                payment_terms: client.payment_terms,
                billing_cycle: client.billing_cycle,
                credit_limit: client.credit_limit,
                preferred_payment_method: client.preferred_payment_method,
                auto_invoice: client.auto_invoice ?? false,
                invoice_delivery_method: client.invoice_delivery_method,
                region_code: client.region_code, // Changed from tax_region
                tax_exemption_certificate: client.tax_exemption_certificate,
                credit_balance: 0,
                tenant
            };

            return convertDatesToISOString({
                ...asset,
                client: transformedClient,
                ...(typeExtensionData ? {
                    [data.asset_type]: typeExtensionData
                } : {})
            });
        });
    }

    static async findById(knexOrTrx: Knex | Knex.Transaction, asset_id: string): Promise<Asset | null> {
        const tenant = await this.getTenant();
        if (!tenant) {
            throw new Error('No tenant found');
        }

        const asset = await knexOrTrx('assets')
            .select(
                'assets.*',
                'clients.client_name',
                'cl.email as email',
                'cl.phone as phone_no',
                'clients.url',
                'cl.address_line1 as address',
                'clients.created_at as client_created_at',
                'clients.updated_at as client_updated_at',
                'clients.is_inactive',
                'clients.is_tax_exempt',
                'clients.client_type',
                'clients.tax_id_number',
                'clients.properties',
                'clients.payment_terms',
                'clients.billing_cycle',
                'clients.credit_limit',
                'clients.preferred_payment_method',
                'clients.auto_invoice',
                'clients.invoice_delivery_method',
                'clients.region_code', // Changed from tax_region
                'clients.tax_exemption_certificate',
                'clients.notes as client_notes'
            )
            .leftJoin('clients', function() {
                this.on('assets.client_id', '=', 'clients.client_id')
                    .andOn('clients.tenant', '=', knexOrTrx.raw('?', [tenant]));
            })
            .leftJoin('client_locations as cl', function() {
                this.on('clients.client_id', '=', 'cl.client_id')
                    .andOn('clients.tenant', '=', 'cl.tenant')
                    .andOn('cl.is_default', '=', knexOrTrx.raw('true'));
            })
            .where({ 'assets.tenant': tenant, 'assets.asset_id': asset_id })
            .first();

        if (!asset) return null;

        // Get extension data if applicable
        const extensionData = await getExtensionData(knexOrTrx, tenant, asset_id, asset.asset_type);

        // Get relationships
        const relationships = await AssetRelationshipModel.findByAsset(knexOrTrx, asset_id);

        // Transform the result
        const transformedAsset = {
            ...asset,
            relationships,
            ...(extensionData ? {
                [asset.asset_type]: extensionData
            } : {})
        };

        return convertDatesToISOString(transformedAsset);
    }

    static async list(knexOrTrx: Knex | Knex.Transaction, params: AssetQueryParams): Promise<AssetListResponse> {
        const tenant = await this.getTenant();
        if (!tenant) {
            throw new Error('No tenant found');
        }

        const { 
            client_id, 
            client_name, 
            asset_type, 
            status, 
            search, 
            maintenance_status,
            maintenance_type,
            page = 1, 
            limit = 10,
            include_client_details = false,
            include_extension_data = false
        } = params;

        let baseQuery = knexOrTrx('assets')
            .select(
                'assets.*',
                'clients.client_name',
                'cl.email as email',
                'cl.phone as phone_no',
                'clients.url',
                'cl.address_line1 as address',
                'clients.created_at as client_created_at',
                'clients.updated_at as client_updated_at',
                'clients.is_inactive',
                'clients.is_tax_exempt',
                'clients.client_type',
                'clients.tax_id_number',
                'clients.properties',
                'clients.payment_terms',
                'clients.billing_cycle',
                'clients.credit_limit',
                'clients.preferred_payment_method',
                'clients.auto_invoice',
                'clients.invoice_delivery_method',
                'clients.region_code', // Changed from tax_region
                'clients.tax_exemption_certificate',
                'clients.notes as client_notes'
            )
            .innerJoin('clients', function() {
                this.on('assets.client_id', '=', 'clients.client_id')
                    .andOn('clients.tenant', '=', 'assets.tenant');
            })
            .leftJoin('client_locations as cl', function() {
                this.on('clients.client_id', '=', 'cl.client_id')
                    .andOn('clients.tenant', '=', 'cl.tenant')
                    .andOn('cl.is_default', '=', knexOrTrx.raw('true'));
            })
            .where('assets.tenant', tenant);

        if (client_id) {
            baseQuery = baseQuery.where('assets.client_id', client_id);
        }
        if (client_name) {
            baseQuery = baseQuery.where('clients.client_name', 'ilike', `%${client_name}%`);
        }
        if (asset_type) {
            baseQuery = baseQuery.where('assets.asset_type', asset_type);
        }
        if (status) {
            baseQuery = baseQuery.where('assets.status', status);
        }
        if (search) {
            baseQuery = baseQuery.where(builder => {
                builder
                    .where('assets.name', 'ilike', `%${search}%`)
                    .orWhere('assets.asset_tag', 'ilike', `%${search}%`)
                    .orWhere('assets.serial_number', 'ilike', `%${search}%`);
            });
        }

        if (maintenance_status) {
            const now = new Date().toISOString();
            baseQuery = baseQuery.leftJoin('asset_maintenance_schedules', function() {
                this.on('assets.asset_id', '=', 'asset_maintenance_schedules.asset_id')
                    .andOn('asset_maintenance_schedules.tenant', '=', knexOrTrx.raw('?', [tenant]));
            });

            switch (maintenance_status) {
                case 'due':
                    baseQuery = baseQuery.where('asset_maintenance_schedules.next_maintenance', '<=', now);
                    break;
                case 'overdue':
                    baseQuery = baseQuery.where('asset_maintenance_schedules.next_maintenance', '<', now);
                    break;
                case 'upcoming':
                    baseQuery = baseQuery.where('asset_maintenance_schedules.next_maintenance', '>', now);
                    break;
                case 'completed':
                    baseQuery = baseQuery.whereNotNull('asset_maintenance_schedules.last_maintenance');
                    break;
            }
        }

        if (maintenance_type) {
            baseQuery = baseQuery.where('asset_maintenance_schedules.maintenance_type', maintenance_type);
        }

        // Get total count using a separate query
        const countQuery = baseQuery.clone();
        const [{ count }] = await countQuery
            .clearSelect()
            .count('* as count');

        const offset = Math.max(0, (page - 1) * limit);
        const assets = await baseQuery
            .orderBy('assets.created_at', 'desc')
            .offset(offset)
            .limit(Math.max(1, limit));

        // Transform results to include client as a nested object and convert dates to ISO strings
        const transformedAssets = await Promise.all(assets.map(async (asset: any): Promise<Asset> => {
            const { 
                client_name,
                email,
                phone_no,
                url,
                address,
                client_created_at,
                client_updated_at,
                is_inactive,
                is_tax_exempt,
                client_type,
                tax_id_number,
                properties,
                payment_terms,
                billing_cycle,
                credit_limit,
                preferred_payment_method,
                auto_invoice,
                invoice_delivery_method,
                region_code, // Changed from tax_region
                tax_exemption_certificate,
                client_notes,
                ...assetData 
            } = asset;

            // Get extension data if requested
            let extensionData: WorkstationAsset | NetworkDeviceAsset | ServerAsset | MobileDeviceAsset | PrinterAsset | null = null;
            if (include_extension_data) {
                extensionData = await getExtensionData(knexOrTrx, tenant, asset.asset_id, asset.asset_type);
            }

            return convertDatesToISOString({
                ...assetData,
                client: client_name ? {
                    client_id: asset.client_id,
                    client_name,
                    email: email ?? '',
                    phone_no: phone_no ?? '',
                    url: url ?? '',
                    address: address ?? '',
                    created_at: client_created_at ?? new Date().toISOString(),
                    updated_at: client_updated_at ?? new Date().toISOString(),
                    is_inactive: is_inactive ?? false,
                    is_tax_exempt: is_tax_exempt ?? false,
                    notes: client_notes ?? '',
                    client_type,
                    tax_id_number,
                    properties,
                    payment_terms,
                    billing_cycle,
                    credit_limit,
                    preferred_payment_method,
                    auto_invoice: auto_invoice ?? false,
                    invoice_delivery_method,
                    region_code, // Changed from tax_region
                    tax_exemption_certificate,
                    tenant
                } : undefined,
                ...(extensionData ? {
                    [asset.asset_type]: extensionData
                } : {})
            });
        }));

        let client_summary;
        if (include_client_details) {
            const assetsByClient = await knexOrTrx('assets')
                .select('client_id')
                .count('* as count')
                .where({ tenant })
                .groupBy('client_id');

            client_summary = {
                total_clients: assetsByClient.length,
                assets_by_client: assetsByClient.reduce<Record<string, number>>((acc, { client_id, count }) => ({
                    ...acc,
                    [client_id]: Number(count)
                }), {})
            };
        }

        return {
            assets: transformedAssets,
            total: Number(count),
            page,
            limit,
            client_summary
        };
    }

    static async delete(knexOrTrx: Knex | Knex.Transaction, asset_id: string): Promise<void> {
        const tenant = await this.getTenant();
        await knexOrTrx('assets')
            .where({ tenant, asset_id })
            .delete();
    }

    static async getClientAssetReport(knexOrTrx: Knex | Knex.Transaction, client_id: string): Promise<ClientMaintenanceSummary> {
        const tenant = await this.getTenant();

        // Get client details
        const client = await knexOrTrx('clients')
            .where({ tenant, client_id })
            .first();

        if (!client) {
            throw new Error('Client not found');
        }

        // Get asset statistics
        const assetStats = await knexOrTrx('assets')
            .where({ tenant, client_id })
            .select(
                knexOrTrx.raw('COUNT(DISTINCT assets.asset_id) as total_assets'),
                knexOrTrx.raw(`
                    COUNT(DISTINCT CASE
                        WHEN asset_maintenance_schedules.asset_id IS NOT NULL
                        THEN assets.asset_id
                    END) as assets_with_maintenance
                `)
            )
            .leftJoin('asset_maintenance_schedules', function() {
                this.on('assets.asset_id', '=', 'asset_maintenance_schedules.asset_id')
                    .andOn('asset_maintenance_schedules.tenant', '=', knexOrTrx.raw('?', [tenant]));
            })
            .first() as unknown as { total_assets: number; assets_with_maintenance: number } | undefined;

        // Get maintenance statistics
        const maintenanceStats = await knexOrTrx('asset_maintenance_schedules')
            .where({ tenant })
            .whereIn('asset_id', knexOrTrx('assets').where({ tenant, client_id }).select('asset_id'))
            .select(
                knexOrTrx.raw('COUNT(*) as total_schedules'),
                knexOrTrx.raw(`
                    COUNT(CASE
                        WHEN next_maintenance < NOW() AND is_active
                        THEN 1
                    END) as overdue_maintenances
                `),
                knexOrTrx.raw(`
                    COUNT(CASE
                        WHEN next_maintenance > NOW() AND is_active
                        THEN 1
                    END) as upcoming_maintenances
                `)
            )
            .first() as unknown as { total_schedules: number; overdue_maintenances: number; upcoming_maintenances: number } | undefined;

        // Get maintenance type breakdown
        const typeBreakdown = await knexOrTrx('asset_maintenance_schedules')
            .where({ tenant })
            .whereIn('asset_id', knexOrTrx('assets').where({ tenant, client_id }).select('asset_id'))
            .select('maintenance_type')
            .count('* as count')
            .groupBy('maintenance_type')
            .then(results => {
                const breakdown: Record<MaintenanceType, number> = {
                    preventive: 0,
                    inspection: 0,
                    calibration: 0,
                    replacement: 0
                };
                results.forEach(({ maintenance_type, count }) => {
                    if (maintenance_type in breakdown) {
                        breakdown[maintenance_type as MaintenanceType] = Number(count);
                    }
                });
                return breakdown;
            });

        // Calculate compliance rate
        const completed = await knexOrTrx('asset_maintenance_history')
            .where({ tenant })
            .whereIn('asset_id', knexOrTrx('assets').where({ tenant, client_id }).select('asset_id'))
            .count('* as count')
            .first();

        const scheduled = await knexOrTrx('asset_maintenance_schedules')
            .where({ tenant })
            .whereIn('asset_id', knexOrTrx('assets').where({ tenant, client_id }).select('asset_id'))
            .sum('frequency_interval as sum')
            .first();

        const completedCount = completed?.count ? Number(completed.count) : 0;
        const scheduledSum = scheduled?.sum ? Number(scheduled.sum) : 0;
        const compliance_rate = scheduledSum > 0 ? (completedCount / scheduledSum) * 100 : 100;

        return convertDatesToISOString({
            client_id,
            client_name: client.client_name,
            total_assets: Number(assetStats?.total_assets || 0),
            assets_with_maintenance: Number(assetStats?.assets_with_maintenance || 0),
            total_schedules: Number(maintenanceStats?.total_schedules || 0),
            overdue_maintenances: Number(maintenanceStats?.overdue_maintenances || 0),
            upcoming_maintenances: Number(maintenanceStats?.upcoming_maintenances || 0),
            compliance_rate,
            maintenance_by_type: typeBreakdown
        });
    }
}

export class AssetHistoryModel extends BaseModel {
    static async create(
        knexOrTrx: Knex | Knex.Transaction,
        asset_id: string, 
        changed_by: string, 
        change_type: string, 
        changes: Record<string, unknown>
    ): Promise<AssetHistory> {
        const tenant = await this.getTenant();
        const [history] = await knexOrTrx('asset_history')
            .insert({
                tenant,
                asset_id,
                changed_by,
                change_type,
                changes,
            })
            .returning('*');
        return convertDatesToISOString(history);
    }

    static async listByAsset(knexOrTrx: Knex | Knex.Transaction, asset_id: string): Promise<AssetHistory[]> {
        const tenant = await this.getTenant();
        const history = await knexOrTrx('asset_history')
            .where({ tenant, asset_id })
            .orderBy('changed_at', 'desc');
        return convertDatesToISOString(history);
    }
}

export class AssetAssociationModel extends BaseModel {
    static async create(knexOrTrx: Knex | Knex.Transaction, data: CreateAssetAssociationRequest, created_by: string): Promise<AssetAssociation> {
        const tenant = await this.getTenant();
        const [association] = await knexOrTrx('asset_associations')
            .insert({
                ...data,
                tenant,
                created_by,
                created_at: new Date().toISOString(),
            })
            .returning('*');
        return convertDatesToISOString(association);
    }

    static async findByAssetAndEntity(
        knexOrTrx: Knex | Knex.Transaction,
        asset_id: string,
        entity_id: string,
        entity_type: string
    ): Promise<AssetAssociation | null> {
        const tenant = await this.getTenant();
        const association = await knexOrTrx('asset_associations')
            .where({
                tenant,
                asset_id,
                entity_id,
                entity_type,
            })
            .first();
        return association ? convertDatesToISOString(association) : null;
    }

    static async listByAsset(knexOrTrx: Knex | Knex.Transaction, asset_id: string): Promise<AssetAssociation[]> {
        const tenant = await this.getTenant();
        const associations = await knexOrTrx('asset_associations')
            .where({ tenant, asset_id })
            .orderBy('created_at', 'desc');
        return convertDatesToISOString(associations);
    }

    static async listByEntity(knexOrTrx: Knex | Knex.Transaction, entity_id: string, entity_type: string): Promise<AssetAssociation[]> {
        const tenant = await this.getTenant();
        const associations = await knexOrTrx('asset_associations')
            .where({ tenant, entity_id, entity_type })
            .orderBy('created_at', 'desc');
        return convertDatesToISOString(associations);
    }

    static async delete(knexOrTrx: Knex | Knex.Transaction, asset_id: string, entity_id: string, entity_type: string): Promise<void> {
        const tenant = await this.getTenant();
        await knexOrTrx('asset_associations')
            .where({
                tenant,
                asset_id,
                entity_id,
                entity_type,
            })
            .delete();
    }
}
