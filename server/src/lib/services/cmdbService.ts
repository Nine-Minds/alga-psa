import { Knex } from 'knex';
import { IConfigurationItem, ICIRelationship, ICIType, ICMDBMetrics } from '../../interfaces/cmdb.interfaces';

export class CMDBService {
  constructor(private knex: Knex) {}

  /**
   * Create a new Configuration Item
   */
  async createCI(ciData: Omit<IConfigurationItem, 'ci_id' | 'created_date' | 'ci_number'>): Promise<string> {
    try {
      // Generate unique CI number
      const ciNumber = await this.generateCINumber(ciData.tenant, ciData.ci_type);

      // Validate CI data against type definition
      await this.validateCIData(ciData);

      const [ci] = await this.knex('configuration_items').insert({
        ...ciData,
        ci_number: ciNumber,
        created_date: new Date()
      }).returning('ci_id');

      // Log the creation
      await this.logCMDBAudit({
        tenant: ciData.tenant,
        ci_id: ci.ci_id,
        entity_type: 'configuration_item',
        action: 'created',
        change_reason: 'manual_update',
        performed_by: ciData.created_by,
        notes: `Configuration Item ${ciData.ci_name} created`
      });

      return ci.ci_id;
    } catch (error) {
      console.error('Error creating CI:', error);
      throw error;
    }
  }

  /**
   * Get CI with full details including relationships
   */
  async getCIDetails(ciId: string): Promise<{
    ci: IConfigurationItem;
    relationships: {
      upstream: ICIRelationship[];
      downstream: ICIRelationship[];
    };
    relatedIncidents: any[];
    relatedChanges: any[];
    auditHistory: any[];
  }> {
    try {
      const ci = await this.knex('configuration_items')
        .where('ci_id', ciId)
        .first();

      if (!ci) {
        throw new Error('Configuration Item not found');
      }

      // Get upstream relationships (CIs this CI depends on)
      const upstreamRelationships = await this.knex('ci_relationships')
        .join('configuration_items as target_ci', 'ci_relationships.target_ci_id', 'target_ci.ci_id')
        .where('ci_relationships.source_ci_id', ciId)
        .where('ci_relationships.status', 'active')
        .select(
          'ci_relationships.*',
          'target_ci.ci_name as target_ci_name',
          'target_ci.ci_type as target_ci_type',
          'target_ci.ci_status as target_ci_status'
        );

      // Get downstream relationships (CIs that depend on this CI)
      const downstreamRelationships = await this.knex('ci_relationships')
        .join('configuration_items as source_ci', 'ci_relationships.source_ci_id', 'source_ci.ci_id')
        .where('ci_relationships.target_ci_id', ciId)
        .where('ci_relationships.status', 'active')
        .select(
          'ci_relationships.*',
          'source_ci.ci_name as source_ci_name',
          'source_ci.ci_type as source_ci_type',
          'source_ci.ci_status as source_ci_status'
        );

      // Get related incidents (would join with tickets table)
      const relatedIncidents = await this.getRelatedIncidents(ciId);

      // Get related changes (would join with change_requests table)
      const relatedChanges = await this.getRelatedChanges(ciId);

      // Get audit history
      const auditHistory = await this.knex('cmdb_audit_log')
        .where('ci_id', ciId)
        .orderBy('performed_date', 'desc')
        .limit(50)
        .select('*');

      return {
        ci,
        relationships: {
          upstream: upstreamRelationships,
          downstream: downstreamRelationships
        },
        relatedIncidents,
        relatedChanges,
        auditHistory
      };
    } catch (error) {
      console.error('Error getting CI details:', error);
      throw error;
    }
  }

  /**
   * Search Configuration Items with advanced filtering
   */
  async searchCIs(
    tenant: string,
    filters: {
      search?: string;
      ci_types?: string[];
      statuses?: string[];
      owners?: string[];
      environments?: string[];
      criticality?: string[];
      location?: string;
      tags?: string[];
    },
    pagination?: {
      page: number;
      limit: number;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    }
  ): Promise<{
    cis: IConfigurationItem[];
    total: number;
    totalPages: number;
  }> {
    try {
      let query = this.knex('configuration_items')
        .where('tenant', tenant);

      // Apply search filter
      if (filters.search) {
        query = query.where(function() {
          this.where('ci_name', 'ilike', `%${filters.search}%`)
            .orWhere('ci_number', 'ilike', `%${filters.search}%`)
            .orWhere('description', 'ilike', `%${filters.search}%`)
            .orWhere('technical_attributes', 'ilike', `%${filters.search}%`);
        });
      }

      // Apply filters
      if (filters.ci_types && filters.ci_types.length > 0) {
        query = query.whereIn('ci_type', filters.ci_types);
      }

      if (filters.statuses && filters.statuses.length > 0) {
        query = query.whereIn('ci_status', filters.statuses);
      }

      if (filters.owners && filters.owners.length > 0) {
        query = query.whereIn('owner', filters.owners);
      }

      if (filters.environments && filters.environments.length > 0) {
        query = query.whereIn('environment', filters.environments);
      }

      if (filters.criticality && filters.criticality.length > 0) {
        query = query.whereIn('business_criticality', filters.criticality);
      }

      if (filters.location) {
        query = query.where('location', 'ilike', `%${filters.location}%`);
      }

      // Get total count
      const totalResult = await query.clone().count('* as total').first();
      const total = parseInt(totalResult?.total as string) || 0;

      // Apply pagination and sorting
      if (pagination) {
        const offset = (pagination.page - 1) * pagination.limit;
        query = query.offset(offset).limit(pagination.limit);

        if (pagination.sortBy) {
          query = query.orderBy(pagination.sortBy, pagination.sortOrder || 'asc');
        }
      }

      if (!pagination?.sortBy) {
        query = query.orderBy('ci_name', 'asc');
      }

      const cis = await query.select('*');
      const totalPages = pagination ? Math.ceil(total / pagination.limit) : 1;

      return { cis, total, totalPages };
    } catch (error) {
      console.error('Error searching CIs:', error);
      throw error;
    }
  }

  /**
   * Create relationship between two CIs
   */
  async createCIRelationship(relationshipData: Omit<ICIRelationship, 'relationship_id' | 'created_date'>): Promise<string> {
    try {
      // Validate relationship
      await this.validateCIRelationship(relationshipData);

      // Check for circular dependencies
      const wouldCreateCircle = await this.checkCircularDependency(
        relationshipData.source_ci_id,
        relationshipData.target_ci_id,
        relationshipData.relationship_type
      );

      if (wouldCreateCircle) {
        throw new Error('This relationship would create a circular dependency');
      }

      const [relationship] = await this.knex('ci_relationships').insert({
        ...relationshipData,
        created_date: new Date()
      }).returning('relationship_id');

      // Log the relationship creation
      await this.logCMDBAudit({
        tenant: relationshipData.tenant,
        relationship_id: relationship.relationship_id,
        entity_type: 'relationship',
        action: 'created',
        change_reason: 'manual_update',
        performed_by: relationshipData.created_by,
        notes: `Relationship created: ${relationshipData.relationship_type}`
      });

      return relationship.relationship_id;
    } catch (error) {
      console.error('Error creating CI relationship:', error);
      throw error;
    }
  }

  /**
   * Get CI dependency tree (both upstream and downstream)
   */
  async getCIDependencyTree(
    ciId: string,
    maxDepth: number = 5,
    direction: 'upstream' | 'downstream' | 'both' = 'both'
  ): Promise<{
    nodes: Array<{
      ci_id: string;
      ci_name: string;
      ci_type: string;
      status: string;
      level: number;
      criticality: string;
    }>;
    edges: Array<{
      source: string;
      target: string;
      relationship_type: string;
      strength: string;
      criticality: string;
    }>;
  }> {
    try {
      const nodes = new Map();
      const edges = new Set();
      const visited = new Set();

      // Add root node
      const rootCI = await this.knex('configuration_items')
        .where('ci_id', ciId)
        .first();

      if (!rootCI) {
        throw new Error('Configuration Item not found');
      }

      nodes.set(ciId, {
        ci_id: ciId,
        ci_name: rootCI.ci_name,
        ci_type: rootCI.ci_type,
        status: rootCI.ci_status,
        level: 0,
        criticality: rootCI.business_criticality
      });

      if (direction === 'downstream' || direction === 'both') {
        await this.buildDependencyTree(ciId, 0, maxDepth, 'downstream', nodes, edges, visited);
      }

      if (direction === 'upstream' || direction === 'both') {
        await this.buildDependencyTree(ciId, 0, maxDepth, 'upstream', nodes, edges, new Set()); // Reset visited for upstream
      }

      return {
        nodes: Array.from(nodes.values()),
        edges: Array.from(edges).map(edge => {
          const [source, target, type, strength, criticality] = (edge as string).split('|');
          return { source, target, relationship_type: type, strength, criticality };
        })
      };
    } catch (error) {
      console.error('Error getting CI dependency tree:', error);
      throw error;
    }
  }

  /**
   * Update CI information
   */
  async updateCI(ciId: string, updateData: Partial<IConfigurationItem>, updatedBy: string): Promise<void> {
    try {
      const existingCI = await this.knex('configuration_items')
        .where('ci_id', ciId)
        .first();

      if (!existingCI) {
        throw new Error('Configuration Item not found');
      }

      // Validate update data
      await this.validateCIData({ ...existingCI, ...updateData });

      // Track field changes for audit
      const fieldChanges = this.getFieldChanges(existingCI, updateData);

      await this.knex('configuration_items')
        .where('ci_id', ciId)
        .update({
          ...updateData,
          updated_date: new Date(),
          updated_by: updatedBy,
          last_modified_date: new Date(),
          last_modified_by: updatedBy
        });

      // Log the update
      await this.logCMDBAudit({
        tenant: existingCI.tenant,
        ci_id: ciId,
        entity_type: 'configuration_item',
        action: 'updated',
        field_changes: fieldChanges,
        change_reason: 'manual_update',
        performed_by: updatedBy
      });
    } catch (error) {
      console.error('Error updating CI:', error);
      throw error;
    }
  }

  /**
   * Get CMDB dashboard metrics
   */
  async getCMDBMetrics(tenant: string): Promise<ICMDBMetrics> {
    try {
      // Get inventory metrics
      const totalCIs = await this.knex('configuration_items')
        .where('tenant', tenant)
        .count('* as count')
        .first();

      const cisByType = await this.knex('configuration_items')
        .where('tenant', tenant)
        .select('ci_type')
        .count('* as count')
        .groupBy('ci_type');

      const cisByStatus = await this.knex('configuration_items')
        .where('tenant', tenant)
        .select('ci_status')
        .count('* as count')
        .groupBy('ci_status');

      const cisByEnvironment = await this.knex('configuration_items')
        .where('tenant', tenant)
        .select('environment')
        .count('* as count')
        .groupBy('environment');

      // Get relationship metrics
      const totalRelationships = await this.knex('ci_relationships')
        .where('tenant', tenant)
        .where('status', 'active')
        .count('* as count')
        .first();

      const relationshipsByType = await this.knex('ci_relationships')
        .where('tenant', tenant)
        .where('status', 'active')
        .select('relationship_type')
        .count('* as count')
        .groupBy('relationship_type');

      const orphanedCIs = await this.knex('configuration_items')
        .leftJoin('ci_relationships as source_rel', 'configuration_items.ci_id', 'source_rel.source_ci_id')
        .leftJoin('ci_relationships as target_rel', 'configuration_items.ci_id', 'target_rel.target_ci_id')
        .where('configuration_items.tenant', tenant)
        .whereNull('source_rel.relationship_id')
        .whereNull('target_rel.relationship_id')
        .count('configuration_items.ci_id as count')
        .first();

      // Get discovery metrics
      const lastDiscovery = await this.knex('discovery_results')
        .where('tenant', tenant)
        .orderBy('discovery_date', 'desc')
        .first();

      const discoveryResults = await this.knex('discovery_results')
        .where('tenant', tenant)
        .where('discovery_date', '>=', this.knex.raw("NOW() - INTERVAL '30 days'"))
        .select(
          this.knex.raw('AVG(CASE WHEN status = ? THEN 1.0 ELSE 0.0 END) * 100 as success_rate', ['completed'])
        )
        .first();

      const pendingValidations = await this.knex('configuration_items')
        .where('tenant', tenant)
        .where('discovery_status', 'pending')
        .count('* as count')
        .first();

      const duplicateSuspects = await this.knex('configuration_items')
        .where('tenant', tenant)
        .where('discovery_status', 'duplicate')
        .count('* as count')
        .first();

      // Calculate quality scores
      const qualityScores = await this.calculateDataQualityScores(tenant);

      // Get compliance metrics
      const complianceData = await this.getComplianceMetrics(tenant);

      return {
        inventory: {
          total_cis: parseInt(totalCIs?.count as string) || 0,
          by_type: this.arrayToObject(cisByType, 'ci_type', 'count'),
          by_status: this.arrayToObject(cisByStatus, 'ci_status', 'count'),
          by_environment: this.arrayToObject(cisByEnvironment, 'environment', 'count')
        },
        relationships: {
          total_relationships: parseInt(totalRelationships?.count as string) || 0,
          by_type: this.arrayToObject(relationshipsByType, 'relationship_type', 'count'),
          orphaned_cis: parseInt(orphanedCIs?.count as string) || 0,
          circular_dependencies: 0 // Would need complex query to detect
        },
        discovery: {
          last_discovery_date: lastDiscovery?.discovery_date || new Date(0),
          discovery_success_rate: parseFloat(discoveryResults?.success_rate as string) || 0,
          pending_validations: parseInt(pendingValidations?.count as string) || 0,
          duplicate_suspects: parseInt(duplicateSuspects?.count as string) || 0
        },
        quality: qualityScores,
        compliance: complianceData
      };
    } catch (error) {
      console.error('Error getting CMDB metrics:', error);
      throw error;
    }
  }

  /**
   * Validate CI lifecycle transitions
   */
  async validateCIStatusTransition(ciId: string, newStatus: string): Promise<{
    valid: boolean;
    violations: string[];
  }> {
    try {
      const ci = await this.knex('configuration_items')
        .where('ci_id', ciId)
        .first();

      if (!ci) {
        return { valid: false, violations: ['Configuration Item not found'] };
      }

      const violations: string[] = [];
      const currentStatus = ci.ci_status;

      // Define valid status transitions
      const validTransitions: { [key: string]: string[] } = {
        'planned': ['ordered', 'under_development', 'withdrawn'],
        'ordered': ['received', 'withdrawn'],
        'received': ['under_development', 'build_complete', 'withdrawn'],
        'under_development': ['build_complete', 'withdrawn'],
        'build_complete': ['live', 'withdrawn'],
        'live': ['withdrawn'],
        'withdrawn': ['disposed'],
        'disposed': [] // Terminal state
      };

      if (!validTransitions[currentStatus]?.includes(newStatus)) {
        violations.push(`Invalid status transition from ${currentStatus} to ${newStatus}`);
      }

      // Additional business rule validations
      if (newStatus === 'live') {
        // Check if CI has required relationships for going live
        const dependencies = await this.knex('ci_relationships')
          .where('source_ci_id', ciId)
          .where('relationship_type', 'depends_on')
          .where('status', 'active');

        // Validate that dependent CIs are also live
        for (const dep of dependencies) {
          const dependentCI = await this.knex('configuration_items')
            .where('ci_id', dep.target_ci_id)
            .first();

          if (dependentCI && dependentCI.ci_status !== 'live') {
            violations.push(`Dependent CI ${dependentCI.ci_name} must be live before this CI can go live`);
          }
        }
      }

      if (newStatus === 'withdrawn') {
        // Check if any CIs depend on this CI
        const dependents = await this.knex('ci_relationships')
          .where('target_ci_id', ciId)
          .where('relationship_type', 'depends_on')
          .where('status', 'active');

        if (dependents.length > 0) {
          violations.push('Cannot withdraw CI that has active dependents');
        }
      }

      return {
        valid: violations.length === 0,
        violations
      };
    } catch (error) {
      console.error('Error validating CI status transition:', error);
      return { valid: false, violations: ['Error occurred during validation'] };
    }
  }

  /**
   * Private helper methods
   */
  private async generateCINumber(tenant: string, ciType: string): Promise<string> {
    const prefix = ciType.substring(0, 3).toUpperCase();
    
    const lastCI = await this.knex('configuration_items')
      .where('tenant', tenant)
      .where('ci_type', ciType)
      .orderBy('created_date', 'desc')
      .first();

    let nextNumber = 1;
    if (lastCI) {
      const lastNumber = parseInt(lastCI.ci_number.substring(prefix.length)) || 0;
      nextNumber = lastNumber + 1;
    }

    return `${prefix}${nextNumber.toString().padStart(6, '0')}`;
  }

  private async validateCIData(ciData: Partial<IConfigurationItem>): Promise<void> {
    // Get CI type definition
    const ciType = await this.knex('ci_types')
      .where('tenant', ciData.tenant)
      .where('type_code', ciData.ci_type)
      .first();

    if (!ciType) {
      throw new Error(`CI type ${ciData.ci_type} not found`);
    }

    // Validate required attributes
    for (const requiredAttr of ciType.required_attributes) {
      if (!ciData.technical_attributes || !ciData.technical_attributes[requiredAttr]) {
        throw new Error(`Required attribute ${requiredAttr} is missing`);
      }
    }

    // Validate attribute definitions
    if (ciData.technical_attributes) {
      for (const [attrName, attrValue] of Object.entries(ciData.technical_attributes)) {
        const attrDef = ciType.attribute_definitions[attrName];
        if (attrDef) {
          await this.validateAttributeValue(attrName, attrValue, attrDef);
        }
      }
    }
  }

  private async validateAttributeValue(attrName: string, value: any, definition: any): Promise<void> {
    switch (definition.type) {
      case 'number':
        if (typeof value !== 'number') {
          throw new Error(`Attribute ${attrName} must be a number`);
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          throw new Error(`Attribute ${attrName} must be a boolean`);
        }
        break;
      case 'date':
        if (!(value instanceof Date) && !Date.parse(value)) {
          throw new Error(`Attribute ${attrName} must be a valid date`);
        }
        break;
      case 'reference':
        if (definition.reference_type) {
          const exists = await this.knex('configuration_items')
            .where('ci_id', value)
            .where('ci_type', definition.reference_type)
            .first();
          if (!exists) {
            throw new Error(`Referenced CI ${value} not found for attribute ${attrName}`);
          }
        }
        break;
    }

    // Custom validation rules
    if (definition.validation) {
      const regex = new RegExp(definition.validation);
      if (!regex.test(value.toString())) {
        throw new Error(`Attribute ${attrName} does not match validation pattern`);
      }
    }
  }

  private async validateCIRelationship(relationshipData: Partial<ICIRelationship>): Promise<void> {
    // Check that source and target CIs exist
    const sourceCi = await this.knex('configuration_items')
      .where('ci_id', relationshipData.source_ci_id)
      .first();

    const targetCi = await this.knex('configuration_items')
      .where('ci_id', relationshipData.target_ci_id)
      .first();

    if (!sourceCi || !targetCi) {
      throw new Error('Source or target CI not found');
    }

    // Check if relationship already exists
    const existingRelationship = await this.knex('ci_relationships')
      .where('source_ci_id', relationshipData.source_ci_id)
      .where('target_ci_id', relationshipData.target_ci_id)
      .where('relationship_type', relationshipData.relationship_type)
      .where('status', 'active')
      .first();

    if (existingRelationship) {
      throw new Error('This relationship already exists');
    }

    // Validate relationship type is allowed between these CI types
    const sourceType = await this.knex('ci_types')
      .where('type_code', sourceCi.ci_type)
      .first();

    if (sourceType) {
      const allowedRelationships = sourceType.allowed_relationships || [];
      const allowedRelationship = allowedRelationships.find(
        (rel: any) => rel.relationship_type === relationshipData.relationship_type
      );

      if (allowedRelationship && !allowedRelationship.target_ci_types.includes(targetCi.ci_type)) {
        throw new Error(`Relationship type ${relationshipData.relationship_type} not allowed between ${sourceCi.ci_type} and ${targetCi.ci_type}`);
      }
    }
  }

  private async checkCircularDependency(sourceId: string, targetId: string, relationshipType: string): Promise<boolean> {
    // Only check for circular dependencies on dependency relationships
    if (relationshipType !== 'depends_on') return false;

    // Check if target depends on source (would create a circle)
    return await this.hasDependencyPath(targetId, sourceId, new Set());
  }

  private async hasDependencyPath(fromId: string, toId: string, visited: Set<string>): Promise<boolean> {
    if (visited.has(fromId)) return false; // Prevent infinite loops
    if (fromId === toId) return true;

    visited.add(fromId);

    const dependencies = await this.knex('ci_relationships')
      .where('source_ci_id', fromId)
      .where('relationship_type', 'depends_on')
      .where('status', 'active')
      .select('target_ci_id');

    for (const dep of dependencies) {
      if (await this.hasDependencyPath(dep.target_ci_id, toId, visited)) {
        return true;
      }
    }

    return false;
  }

  private async buildDependencyTree(
    ciId: string,
    currentLevel: number,
    maxDepth: number,
    direction: 'upstream' | 'downstream',
    nodes: Map<string, any>,
    edges: Set<string>,
    visited: Set<string>
  ): Promise<void> {
    if (currentLevel >= maxDepth || visited.has(ciId)) return;

    visited.add(ciId);

    let relationships;
    if (direction === 'downstream') {
      relationships = await this.knex('ci_relationships')
        .join('configuration_items', 'ci_relationships.source_ci_id', 'configuration_items.ci_id')
        .where('ci_relationships.target_ci_id', ciId)
        .where('ci_relationships.status', 'active')
        .select(
          'ci_relationships.*',
          'configuration_items.ci_name',
          'configuration_items.ci_type',
          'configuration_items.ci_status',
          'configuration_items.business_criticality'
        );
    } else {
      relationships = await this.knex('ci_relationships')
        .join('configuration_items', 'ci_relationships.target_ci_id', 'configuration_items.ci_id')
        .where('ci_relationships.source_ci_id', ciId)
        .where('ci_relationships.status', 'active')
        .select(
          'ci_relationships.*',
          'configuration_items.ci_name',
          'configuration_items.ci_type',
          'configuration_items.ci_status',
          'configuration_items.business_criticality'
        );
    }

    for (const rel of relationships) {
      const relatedCiId = direction === 'downstream' ? rel.source_ci_id : rel.target_ci_id;
      
      if (!nodes.has(relatedCiId)) {
        nodes.set(relatedCiId, {
          ci_id: relatedCiId,
          ci_name: rel.ci_name,
          ci_type: rel.ci_type,
          status: rel.ci_status,
          level: currentLevel + 1,
          criticality: rel.business_criticality
        });
      }

      const edgeKey = `${rel.source_ci_id}|${rel.target_ci_id}|${rel.relationship_type}|${rel.strength}|${rel.criticality}`;
      edges.add(edgeKey);

      await this.buildDependencyTree(relatedCiId, currentLevel + 1, maxDepth, direction, nodes, edges, visited);
    }
  }

  private getFieldChanges(existingData: any, updateData: any): any[] {
    const changes = [];
    for (const [field, newValue] of Object.entries(updateData)) {
      const oldValue = existingData[field];
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changes.push({
          field_name: field,
          old_value: oldValue,
          new_value: newValue
        });
      }
    }
    return changes;
  }

  private async logCMDBAudit(auditData: any): Promise<void> {
    try {
      await this.knex('cmdb_audit_log').insert({
        audit_id: this.knex.raw('uuid_generate_v4()'),
        ...auditData,
        performed_date: new Date()
      });
    } catch (error) {
      console.error('Error logging CMDB audit:', error);
    }
  }

  private async getRelatedIncidents(ciId: string): Promise<any[]> {
    // This would join with the tickets table to find incidents related to this CI
    // For now, return empty array
    return [];
  }

  private async getRelatedChanges(ciId: string): Promise<any[]> {
    // This would join with the change_requests table to find changes related to this CI
    // For now, return empty array
    return [];
  }

  private async calculateDataQualityScores(tenant: string): Promise<any> {
    // Simplified quality score calculation
    const totalCIs = await this.knex('configuration_items')
      .where('tenant', tenant)
      .count('* as count')
      .first();

    const total = parseInt(totalCIs?.count as string) || 1;

    // Completeness: CIs with all required attributes filled
    const completeCIs = await this.knex('configuration_items')
      .where('tenant', tenant)
      .whereNotNull('description')
      .whereNotNull('owner')
      .whereNotNull('custodian')
      .count('* as count')
      .first();

    const completeness = (parseInt(completeCIs?.count as string) / total) * 100;

    // Accuracy: CIs validated within last 90 days
    const accurateCIs = await this.knex('configuration_items')
      .where('tenant', tenant)
      .where('discovery_status', 'confirmed')
      .where('last_discovered', '>=', this.knex.raw("NOW() - INTERVAL '90 days'"))
      .count('* as count')
      .first();

    const accuracy = (parseInt(accurateCIs?.count as string) / total) * 100;

    // Freshness: CIs modified within last 180 days
    const freshCIs = await this.knex('configuration_items')
      .where('tenant', tenant)
      .where('last_modified_date', '>=', this.knex.raw("NOW() - INTERVAL '180 days'"))
      .count('* as count')
      .first();

    const freshness = (parseInt(freshCIs?.count as string) / total) * 100;

    // Consistency: Relationship consistency (simplified)
    const consistency = 85; // Would need complex calculation

    return {
      completeness_score: Math.round(completeness),
      accuracy_score: Math.round(accuracy),
      consistency_score: consistency,
      freshness_score: Math.round(freshness)
    };
  }

  private async getComplianceMetrics(tenant: string): Promise<any> {
    // Simplified compliance metrics
    const totalCIs = await this.knex('configuration_items')
      .where('tenant', tenant)
      .count('* as count')
      .first();

    const total = parseInt(totalCIs?.count as string) || 1;

    // Compliant CIs (have required compliance requirements)
    const compliantCIs = await this.knex('configuration_items')
      .where('tenant', tenant)
      .whereRaw("json_array_length(compliance_requirements) > 0")
      .count('* as count')
      .first();

    const compliant = parseInt(compliantCIs?.count as string) || 0;

    return {
      compliant_cis: compliant,
      non_compliant_cis: total - compliant,
      compliance_by_type: {},
      audit_findings: 0
    };
  }

  private arrayToObject(array: any[], keyField: string, valueField: string): { [key: string]: number } {
    const result: { [key: string]: number } = {};
    for (const item of array) {
      result[item[keyField]] = parseInt(item[valueField]);
    }
    return result;
  }
}

export default CMDBService;