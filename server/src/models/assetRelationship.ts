import { createTenantKnex } from '../lib/db';
import { AssetRelationship } from '../interfaces/asset.interfaces';
import { Knex } from 'knex';

interface RelationshipRow {
    parent_asset_id: string;
    child_asset_id: string;
    relationship_type: string;
    parent_name: string;
    child_name: string;
    level: number;
    tenant: string;
    created_at: string;
    updated_at: string;
}

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

export class AssetRelationshipModel {
    private static async checkForCircularRelationship(
        knex: Knex,
        tenant: string,
        parent_asset_id: string,
        child_asset_id: string
    ): Promise<boolean> {
        // Use a recursive CTE to detect cycles
        const result = await knex.raw(`
            WITH RECURSIVE relationship_path AS (
                -- Base case: direct relationships
                SELECT 
                    parent_asset_id,
                    child_asset_id,
                    ARRAY[parent_asset_id, child_asset_id] as path,
                    false as has_cycle
                FROM asset_relationships
                WHERE tenant = ?

                UNION ALL

                -- Recursive case: follow the chain of relationships
                SELECT 
                    r.parent_asset_id,
                    r.child_asset_id,
                    rp.path || r.child_asset_id,
                    r.child_asset_id = ANY(rp.path) as has_cycle
                FROM asset_relationships r
                INNER JOIN relationship_path rp ON r.parent_asset_id = rp.child_asset_id
                WHERE r.tenant = ? AND NOT rp.has_cycle
            )
            -- Check if adding the new relationship would create a cycle
            SELECT EXISTS (
                SELECT 1 FROM relationship_path
                WHERE has_cycle = true
                UNION
                SELECT true WHERE ? = ANY(
                    SELECT unnest(path) FROM relationship_path WHERE ? = ANY(path)
                )
            ) as would_create_cycle;
        `, [tenant, tenant, child_asset_id, parent_asset_id]);

        return result.rows[0].would_create_cycle;
    }

    static async create(
        tenant: string,
        parent_asset_id: string,
        child_asset_id: string,
        relationship_type: string
    ): Promise<AssetRelationship> {
        const { knex } = await createTenantKnex();

        // Check for self-referential relationship
        if (parent_asset_id === child_asset_id) {
            throw new Error('An asset cannot be related to itself');
        }

        // Check for circular relationships
        const wouldCreateCycle = await this.checkForCircularRelationship(
            knex,
            tenant,
            parent_asset_id,
            child_asset_id
        );

        if (wouldCreateCycle) {
            throw new Error('This relationship would create a circular dependency');
        }

        const [relationship] = await knex('asset_relationships')
            .insert({
                tenant,
                parent_asset_id,
                child_asset_id,
                relationship_type,
            })
            .returning('*');

        return convertDatesToISOString(relationship);
    }

    static async findByAsset(asset_id: string): Promise<AssetRelationship[]> {
        const { knex } = await createTenantKnex();
        
        // Get both parent and child relationships
        const relationships = await knex('asset_relationships as ar')
            .select(
                'ar.*',
                'parent.name as parent_name',
                'child.name as child_name'
            )
            .leftJoin('assets as parent', function() {
                this.on('ar.parent_asset_id', '=', 'parent.asset_id')
                    .andOn('ar.tenant', '=', 'parent.tenant');
            })
            .leftJoin('assets as child', function() {
                this.on('ar.child_asset_id', '=', 'child.asset_id')
                    .andOn('ar.tenant', '=', 'child.tenant');
            })
            .where(function() {
                this.where('ar.parent_asset_id', asset_id)
                    .orWhere('ar.child_asset_id', asset_id);
            });

        return relationships.map((rel): AssetRelationship => ({
            ...rel,
            name: asset_id === rel.parent_asset_id ? rel.child_name : rel.parent_name
        }));
    }

    static async delete(
        tenant: string,
        parent_asset_id: string,
        child_asset_id: string
    ): Promise<void> {
        const { knex } = await createTenantKnex();
        await knex('asset_relationships')
            .where({
                tenant,
                parent_asset_id,
                child_asset_id,
            })
            .delete();
    }

    static async getFullHierarchy(asset_id: string): Promise<AssetRelationship[]> {
        const { knex } = await createTenantKnex();
        
        // Use a recursive CTE to get the full hierarchy (both up and down)
        const result = await knex.raw(`
            WITH RECURSIVE full_hierarchy AS (
                -- Base case: direct relationships
                SELECT 
                    ar.*,
                    parent.name as parent_name,
                    child.name as child_name,
                    1 as level,
                    ARRAY[ar.parent_asset_id, ar.child_asset_id] as path
                FROM asset_relationships ar
                JOIN assets parent ON ar.parent_asset_id = parent.asset_id AND ar.tenant = parent.tenant
                JOIN assets child ON ar.child_asset_id = child.asset_id AND ar.tenant = child.tenant
                WHERE (ar.parent_asset_id = ? OR ar.child_asset_id = ?)
                AND ar.tenant = parent.tenant
                AND ar.tenant = child.tenant

                UNION ALL

                -- Recursive case: both up and down the hierarchy
                SELECT 
                    ar.*,
                    parent.name as parent_name,
                    child.name as child_name,
                    h.level + 1,
                    h.path || ar.child_asset_id
                FROM asset_relationships ar
                JOIN full_hierarchy h ON 
                    (ar.parent_asset_id = h.child_asset_id OR ar.child_asset_id = h.parent_asset_id)
                    AND ar.tenant = h.tenant
                JOIN assets parent ON ar.parent_asset_id = parent.asset_id AND ar.tenant = parent.tenant
                JOIN assets child ON ar.child_asset_id = child.asset_id AND ar.tenant = child.tenant
                WHERE NOT (ar.child_asset_id = ANY(h.path)) -- Prevent cycles
                AND h.level < 10 -- Limit depth to prevent runaway queries
            )
            SELECT DISTINCT ON (parent_asset_id, child_asset_id)
                parent_asset_id,
                child_asset_id,
                relationship_type,
                parent_name,
                child_name,
                level,
                tenant,
                created_at,
                updated_at
            FROM full_hierarchy
            ORDER BY parent_asset_id, child_asset_id, level;
        `, [asset_id, asset_id]);

        return result.rows.map((row: RelationshipRow): AssetRelationship => ({
            ...row,
            name: asset_id === row.parent_asset_id ? row.child_name : row.parent_name
        }));
    }
}
