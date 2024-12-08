import { AssetRelationshipModel } from './assetRelationship';

import { createTenantKnex } from '../lib/db';
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
import { ICompany } from '../interfaces/company.interfaces';
import { Knex } from 'knex';

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

export class AssetModel {
    static async create(data: CreateAssetRequest): Promise<Asset> {
        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('No tenant found');
        }

        return knex.transaction(async (trx) => {
            // Verify company exists and get full company details
            const company = await trx('companies')
                .select('*')
                .where({ tenant, company_id: data.company_id })
                .first();

            if (!company) {
                throw new Error('Company not found');
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

            // Transform company data
            const transformedCompany: ICompany = {
                company_id: company.company_id,
                company_name: company.company_name,
                email: company.email ?? '',
                phone_no: company.phone_no ?? '',
                url: company.url ?? '',
                address: company.address ?? '',
                created_at: company.created_at ?? new Date().toISOString(),
                updated_at: company.updated_at ?? new Date().toISOString(),
                is_inactive: company.is_inactive ?? false,
                is_tax_exempt: company.is_tax_exempt ?? false,
                notes: company.notes ?? '',
                client_type: company.client_type,
                tax_id_number: company.tax_id_number,
                properties: company.properties,
                payment_terms: company.payment_terms,
                billing_cycle: company.billing_cycle,
                credit_limit: company.credit_limit,
                preferred_payment_method: company.preferred_payment_method,
                auto_invoice: company.auto_invoice ?? false,
                invoice_delivery_method: company.invoice_delivery_method,
                tax_region: company.tax_region,
                tax_exemption_certificate: company.tax_exemption_certificate,
                credit_balance: 0,
                tenant
            };

            return convertDatesToISOString({
                ...asset,
                company: transformedCompany,
                ...(typeExtensionData ? {
                    [data.asset_type]: typeExtensionData
                } : {})
            });
        });
    }

    static async findById(asset_id: string): Promise<Asset | null> {
        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('No tenant found');
        }

        const asset = await knex('assets')
            .select(
                'assets.*',
                'companies.company_name',
                'companies.email',
                'companies.phone_no',
                'companies.url',
                'companies.address',
                'companies.created_at as company_created_at',
                'companies.updated_at as company_updated_at',
                'companies.is_inactive',
                'companies.is_tax_exempt',
                'companies.client_type',
                'companies.tax_id_number',
                'companies.properties',
                'companies.payment_terms',
                'companies.billing_cycle',
                'companies.credit_limit',
                'companies.preferred_payment_method',
                'companies.auto_invoice',
                'companies.invoice_delivery_method',
                'companies.tax_region',
                'companies.tax_exemption_certificate',
                'companies.notes as company_notes'
            )
            .leftJoin('companies', function() {
                this.on('assets.company_id', '=', 'companies.company_id')
                    .andOn('companies.tenant', '=', knex.raw('?', [tenant]));
            })
            .where({ 'assets.tenant': tenant, 'assets.asset_id': asset_id })
            .first();

        if (!asset) return null;

        // Get extension data if applicable
        const extensionData = await getExtensionData(knex, tenant, asset_id, asset.asset_type);

        // Get relationships
        const relationships = await AssetRelationshipModel.findByAsset(asset_id);

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

    static async list(params: AssetQueryParams): Promise<AssetListResponse> {
        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('No tenant found');
        }

        const { 
            company_id, 
            company_name, 
            asset_type, 
            status, 
            search, 
            maintenance_status,
            maintenance_type,
            page = 1, 
            limit = 10,
            include_company_details = false,
            include_extension_data = false
        } = params;

        let baseQuery = knex('assets')
            .select(
                'assets.*',
                'companies.company_name',
                'companies.email',
                'companies.phone_no',
                'companies.url',
                'companies.address',
                'companies.created_at as company_created_at',
                'companies.updated_at as company_updated_at',
                'companies.is_inactive',
                'companies.is_tax_exempt',
                'companies.client_type',
                'companies.tax_id_number',
                'companies.properties',
                'companies.payment_terms',
                'companies.billing_cycle',
                'companies.credit_limit',
                'companies.preferred_payment_method',
                'companies.auto_invoice',
                'companies.invoice_delivery_method',
                'companies.tax_region',
                'companies.tax_exemption_certificate',
                'companies.notes as company_notes'
            )
            .innerJoin('companies', function() {
                this.on('assets.company_id', '=', 'companies.company_id')
                    .andOn('companies.tenant', '=', 'assets.tenant');
            })
            .where('assets.tenant', tenant);

        if (company_id) {
            baseQuery = baseQuery.where('assets.company_id', company_id);
        }
        if (company_name) {
            baseQuery = baseQuery.where('companies.company_name', 'ilike', `%${company_name}%`);
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
                    .andOn('asset_maintenance_schedules.tenant', '=', knex.raw('?', [tenant]));
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

        // Transform results to include company as a nested object and convert dates to ISO strings
        const transformedAssets = await Promise.all(assets.map(async (asset: any): Promise<Asset> => {
            const { 
                company_name,
                email,
                phone_no,
                url,
                address,
                company_created_at,
                company_updated_at,
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
                tax_region,
                tax_exemption_certificate,
                company_notes,
                ...assetData 
            } = asset;

            // Get extension data if requested
            let extensionData = null;
            if (include_extension_data) {
                extensionData = await getExtensionData(knex, tenant, asset.asset_id, asset.asset_type);
            }

            return convertDatesToISOString({
                ...assetData,
                company: company_name ? {
                    company_id: asset.company_id,
                    company_name,
                    email: email ?? '',
                    phone_no: phone_no ?? '',
                    url: url ?? '',
                    address: address ?? '',
                    created_at: company_created_at ?? new Date().toISOString(),
                    updated_at: company_updated_at ?? new Date().toISOString(),
                    is_inactive: is_inactive ?? false,
                    is_tax_exempt: is_tax_exempt ?? false,
                    notes: company_notes ?? '',
                    client_type,
                    tax_id_number,
                    properties,
                    payment_terms,
                    billing_cycle,
                    credit_limit,
                    preferred_payment_method,
                    auto_invoice: auto_invoice ?? false,
                    invoice_delivery_method,
                    tax_region,
                    tax_exemption_certificate,
                    tenant
                } : undefined,
                ...(extensionData ? {
                    [asset.asset_type]: extensionData
                } : {})
            });
        }));

        let company_summary;
        if (include_company_details) {
            const assetsByCompany = await knex('assets')
                .select('company_id')
                .count('* as count')
                .where({ tenant })
                .groupBy('company_id');

            company_summary = {
                total_companies: assetsByCompany.length,
                assets_by_company: assetsByCompany.reduce<Record<string, number>>((acc, { company_id, count }) => ({
                    ...acc,
                    [company_id]: Number(count)
                }), {})
            };
        }

        return {
            assets: transformedAssets,
            total: Number(count),
            page,
            limit,
            company_summary
        };
    }

    static async delete(asset_id: string): Promise<void> {
        const { knex, tenant } = await createTenantKnex();
        await knex('assets')
            .where({ tenant, asset_id })
            .delete();
    }

    static async getCompanyAssetReport(company_id: string): Promise<ClientMaintenanceSummary> {
        const { knex, tenant } = await createTenantKnex();

        // Get company details
        const company = await knex('companies')
            .where({ tenant, company_id })
            .first();

        if (!company) {
            throw new Error('Company not found');
        }

        // Get asset statistics
        const assetStats = await knex('assets')
            .where({ tenant, company_id })
            .select(
                knex.raw('COUNT(DISTINCT assets.asset_id) as total_assets'),
                knex.raw(`
                    COUNT(DISTINCT CASE 
                        WHEN asset_maintenance_schedules.asset_id IS NOT NULL 
                        THEN assets.asset_id 
                    END) as assets_with_maintenance
                `)
            )
            .leftJoin('asset_maintenance_schedules', function() {
                this.on('assets.asset_id', '=', 'asset_maintenance_schedules.asset_id')
                    .andOn('asset_maintenance_schedules.tenant', '=', knex.raw('?', [tenant]));
            })
            .first();

        // Get maintenance statistics
        const maintenanceStats = await knex('asset_maintenance_schedules')
            .where({ tenant })
            .whereIn('asset_id', knex('assets').where({ tenant, company_id }).select('asset_id'))
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
            .where({ tenant })
            .whereIn('asset_id', knex('assets').where({ tenant, company_id }).select('asset_id'))
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
        const completed = await knex('asset_maintenance_history')
            .where({ tenant })
            .whereIn('asset_id', knex('assets').where({ tenant, company_id }).select('asset_id'))
            .count('* as count')
            .first();

        const scheduled = await knex('asset_maintenance_schedules')
            .where({ tenant })
            .whereIn('asset_id', knex('assets').where({ tenant, company_id }).select('asset_id'))
            .sum('frequency_interval as sum')
            .first();

        const completedCount = completed?.count ? Number(completed.count) : 0;
        const scheduledSum = scheduled?.sum ? Number(scheduled.sum) : 0;
        const compliance_rate = scheduledSum > 0 ? (completedCount / scheduledSum) * 100 : 100;

        return convertDatesToISOString({
            company_id,
            company_name: company.company_name,
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

export class AssetHistoryModel {
    static async create(
        asset_id: string, 
        changed_by: string, 
        change_type: string, 
        changes: Record<string, unknown>
    ): Promise<AssetHistory> {
        const { knex, tenant } = await createTenantKnex();
        const [history] = await knex('asset_history')
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

    static async listByAsset(asset_id: string): Promise<AssetHistory[]> {
        const { knex, tenant } = await createTenantKnex();
        const history = await knex('asset_history')
            .where({ tenant, asset_id })
            .orderBy('changed_at', 'desc');
        return convertDatesToISOString(history);
    }
}

export class AssetAssociationModel {
    static async create(data: CreateAssetAssociationRequest, created_by: string): Promise<AssetAssociation> {
        const { knex, tenant } = await createTenantKnex();
        const [association] = await knex('asset_associations')
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
        asset_id: string,
        entity_id: string,
        entity_type: string
    ): Promise<AssetAssociation | null> {
        const { knex, tenant } = await createTenantKnex();
        const association = await knex('asset_associations')
            .where({
                tenant,
                asset_id,
                entity_id,
                entity_type,
            })
            .first();
        return association ? convertDatesToISOString(association) : null;
    }

    static async listByAsset(asset_id: string): Promise<AssetAssociation[]> {
        const { knex, tenant } = await createTenantKnex();
        const associations = await knex('asset_associations')
            .where({ tenant, asset_id })
            .orderBy('created_at', 'desc');
        return convertDatesToISOString(associations);
    }

    static async listByEntity(entity_id: string, entity_type: string): Promise<AssetAssociation[]> {
        const { knex, tenant } = await createTenantKnex();
        const associations = await knex('asset_associations')
            .where({ tenant, entity_id, entity_type })
            .orderBy('created_at', 'desc');
        return convertDatesToISOString(associations);
    }

    static async delete(asset_id: string, entity_id: string, entity_type: string): Promise<void> {
        const { knex, tenant } = await createTenantKnex();
        await knex('asset_associations')
            .where({
                tenant,
                asset_id,
                entity_id,
                entity_type,
            })
            .delete();
    }
}
