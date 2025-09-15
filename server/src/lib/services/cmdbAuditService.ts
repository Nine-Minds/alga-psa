import { ICMDBAuditLog, IConfigurationItem, ICIRelationship } from '../../interfaces/cmdb.interfaces';
import knex from '../db';
import { v4 as uuidv4 } from 'uuid';

export class CMDBAuditService {
  
  async logConfigurationItemChange(
    ciId: string,
    action: 'created' | 'updated' | 'deleted' | 'status_changed' | 'discovered' | 'validated',
    performedBy: string,
    oldValues?: Partial<IConfigurationItem>,
    newValues?: Partial<IConfigurationItem>,
    changeReason?: 'manual_update' | 'discovery' | 'import' | 'change_request' | 'incident_resolution',
    changeRequestId?: string,
    incidentId?: string,
    notes?: string
  ): Promise<ICMDBAuditLog> {
    const ci = await knex('configuration_items').where('ci_id', ciId).first();
    if (!ci) {
      throw new Error(`Configuration Item ${ciId} not found`);
    }

    const fieldChanges = this.calculateFieldChanges(oldValues, newValues);
    
    const auditLog: ICMDBAuditLog = {
      audit_id: uuidv4(),
      tenant: ci.tenant,
      ci_id: ciId,
      entity_type: 'configuration_item',
      action,
      field_changes: fieldChanges,
      change_reason: changeReason,
      change_request_id: changeRequestId,
      incident_id: incidentId,
      performed_by: performedBy,
      performed_date: new Date(),
      source_system: 'cmdb',
      notes,
      validated: false
    };

    await knex('cmdb_audit_log').insert({
      ...auditLog,
      field_changes: JSON.stringify(auditLog.field_changes || [])
    });

    return auditLog;
  }

  async logRelationshipChange(
    relationshipId: string,
    action: 'created' | 'updated' | 'deleted' | 'status_changed' | 'discovered' | 'validated',
    performedBy: string,
    oldValues?: Partial<ICIRelationship>,
    newValues?: Partial<ICIRelationship>,
    changeReason?: 'manual_update' | 'discovery' | 'import' | 'change_request' | 'incident_resolution',
    changeRequestId?: string,
    incidentId?: string,
    notes?: string
  ): Promise<ICMDBAuditLog> {
    const relationship = await knex('ci_relationships').where('relationship_id', relationshipId).first();
    if (!relationship) {
      throw new Error(`Relationship ${relationshipId} not found`);
    }

    const fieldChanges = this.calculateFieldChanges(oldValues, newValues);
    
    const auditLog: ICMDBAuditLog = {
      audit_id: uuidv4(),
      tenant: relationship.tenant,
      relationship_id: relationshipId,
      entity_type: 'relationship',
      action,
      field_changes: fieldChanges,
      change_reason: changeReason,
      change_request_id: changeRequestId,
      incident_id: incidentId,
      performed_by: performedBy,
      performed_date: new Date(),
      source_system: 'cmdb',
      notes,
      validated: false
    };

    await knex('cmdb_audit_log').insert({
      ...auditLog,
      field_changes: JSON.stringify(auditLog.field_changes || [])
    });

    return auditLog;
  }

  async validateAuditEntry(auditId: string, validatedBy: string, validationNotes?: string): Promise<void> {
    await knex('cmdb_audit_log')
      .where('audit_id', auditId)
      .update({
        validated: true,
        validation_date: new Date(),
        validated_by: validatedBy,
        notes: validationNotes ? knex.raw('CONCAT(COALESCE(notes, \'\'), \' | Validation: \', ?)', [validationNotes]) : knex.raw('notes')
      });
  }

  async getAuditHistory(
    ciId?: string,
    relationshipId?: string,
    startDate?: Date,
    endDate?: Date,
    actions?: string[],
    performedBy?: string,
    limit: number = 100
  ): Promise<ICMDBAuditLog[]> {
    let query = knex('cmdb_audit_log').orderBy('performed_date', 'desc').limit(limit);

    if (ciId) {
      query = query.where('ci_id', ciId);
    }

    if (relationshipId) {
      query = query.where('relationship_id', relationshipId);
    }

    if (startDate) {
      query = query.where('performed_date', '>=', startDate);
    }

    if (endDate) {
      query = query.where('performed_date', '<=', endDate);
    }

    if (actions && actions.length > 0) {
      query = query.whereIn('action', actions);
    }

    if (performedBy) {
      query = query.where('performed_by', performedBy);
    }

    const results = await query;
    
    return results.map(result => ({
      ...result,
      field_changes: result.field_changes ? JSON.parse(result.field_changes) : []
    }));
  }

  async generateComplianceReport(tenant: string, complianceFramework: string = 'ITIL'): Promise<any> {
    const report = {
      framework: complianceFramework,
      tenant,
      generated_date: new Date(),
      overall_score: 0,
      sections: {} as any
    };

    switch (complianceFramework.toUpperCase()) {
      case 'ITIL':
        report.sections = await this.generateITILComplianceReport(tenant);
        break;
      case 'SOX':
        report.sections = await this.generateSOXComplianceReport(tenant);
        break;
      case 'ISO20000':
        report.sections = await this.generateISO20000ComplianceReport(tenant);
        break;
      case 'COBIT':
        report.sections = await this.generateCOBITComplianceReport(tenant);
        break;
      default:
        report.sections = await this.generateGenericComplianceReport(tenant);
    }

    report.overall_score = this.calculateOverallComplianceScore(report.sections);
    return report;
  }

  private async generateITILComplianceReport(tenant: string): Promise<any> {
    const sections = {
      configuration_management: await this.assessConfigurationManagementCompliance(tenant),
      change_management: await this.assessChangeManagementCompliance(tenant),
      incident_management: await this.assessIncidentManagementCompliance(tenant),
      problem_management: await this.assessProblemManagementCompliance(tenant),
      service_level_management: await this.assessServiceLevelManagementCompliance(tenant),
      data_quality: await this.assessDataQualityCompliance(tenant),
      audit_trail: await this.assessAuditTrailCompliance(tenant)
    };

    return sections;
  }

  private async assessConfigurationManagementCompliance(tenant: string): Promise<any> {
    const totalCIs = await knex('configuration_items').where('tenant', tenant).count('* as count');
    const totalCount = totalCIs[0].count as number;

    const cisWithOwners = await knex('configuration_items')
      .where('tenant', tenant)
      .whereNotNull('owner')
      .count('* as count');

    const cisWithCustodians = await knex('configuration_items')
      .where('tenant', tenant)
      .whereNotNull('custodian')
      .count('* as count');

    const recentlyUpdatedCIs = await knex('configuration_items')
      .where('tenant', tenant)
      .where('last_modified_date', '>', knex.raw('NOW() - INTERVAL 90 DAY'))
      .count('* as count');

    const cisWithRelationships = await knex('configuration_items')
      .where('tenant', tenant)
      .whereExists(function() {
        this.select('*')
          .from('ci_relationships')
          .where('tenant', tenant)
          .whereRaw('source_ci_id = configuration_items.ci_id OR target_ci_id = configuration_items.ci_id');
      })
      .count('* as count');

    const ownershipCompliance = totalCount > 0 ? (cisWithOwners[0].count as number / totalCount) * 100 : 0;
    const custodianCompliance = totalCount > 0 ? (cisWithCustodians[0].count as number / totalCount) * 100 : 0;
    const freshnessCompliance = totalCount > 0 ? (recentlyUpdatedCIs[0].count as number / totalCount) * 100 : 0;
    const relationshipCompliance = totalCount > 0 ? (cisWithRelationships[0].count as number / totalCount) * 100 : 0;

    const score = (ownershipCompliance + custodianCompliance + freshnessCompliance + relationshipCompliance) / 4;

    return {
      score: Math.round(score),
      details: {
        total_cis: totalCount,
        ownership_compliance: Math.round(ownershipCompliance),
        custodian_compliance: Math.round(custodianCompliance),
        data_freshness_compliance: Math.round(freshnessCompliance),
        relationship_compliance: Math.round(relationshipCompliance)
      },
      recommendations: this.generateConfigurationManagementRecommendations(ownershipCompliance, custodianCompliance, freshnessCompliance, relationshipCompliance)
    };
  }

  private async assessChangeManagementCompliance(tenant: string): Promise<any> {
    const totalChanges = await knex('change_requests').where('tenant', tenant).count('* as count');
    const totalCount = totalChanges[0].count as number;

    const authorizedChanges = await knex('change_requests')
      .where('tenant', tenant)
      .whereIn('approval_status', ['approved', 'conditionally_approved'])
      .count('* as count');

    const changesWithImpactAnalysis = await knex('change_requests')
      .where('tenant', tenant)
      .whereNotNull('impact_assessment')
      .count('* as count');

    const changesWithRollbackPlan = await knex('change_requests')
      .where('tenant', tenant)
      .whereNotNull('rollback_plan')
      .count('* as count');

    const emergencyChangesApproved = await knex('change_requests')
      .where('tenant', tenant)
      .where('change_type', 'emergency')
      .where('approval_status', 'approved')
      .count('* as count');

    const authorizationCompliance = totalCount > 0 ? (authorizedChanges[0].count as number / totalCount) * 100 : 100;
    const impactAnalysisCompliance = totalCount > 0 ? (changesWithImpactAnalysis[0].count as number / totalCount) * 100 : 100;
    const rollbackCompliance = totalCount > 0 ? (changesWithRollbackPlan[0].count as number / totalCount) * 100 : 100;

    const score = (authorizationCompliance + impactAnalysisCompliance + rollbackCompliance) / 3;

    return {
      score: Math.round(score),
      details: {
        total_changes: totalCount,
        authorization_compliance: Math.round(authorizationCompliance),
        impact_analysis_compliance: Math.round(impactAnalysisCompliance),
        rollback_plan_compliance: Math.round(rollbackCompliance),
        emergency_changes_approved: emergencyChangesApproved[0].count
      },
      recommendations: this.generateChangeManagementRecommendations(authorizationCompliance, impactAnalysisCompliance, rollbackCompliance)
    };
  }

  private async assessDataQualityCompliance(tenant: string): Promise<any> {
    const totalCIs = await knex('configuration_items').where('tenant', tenant).count('* as count');
    const totalCount = totalCIs[0].count as number;

    const cisWithAllRequiredFields = await knex('configuration_items')
      .where('tenant', tenant)
      .whereNotNull('ci_name')
      .whereNotNull('description')
      .whereNotNull('owner')
      .whereNotNull('custodian')
      .count('* as count');

    const duplicateCIs = await knex.raw(`
      SELECT COUNT(*) as count FROM (
        SELECT ci_name, ci_type, COUNT(*) as cnt
        FROM configuration_items
        WHERE tenant = ?
        GROUP BY ci_name, ci_type
        HAVING COUNT(*) > 1
      ) duplicates
    `, [tenant]);

    const orphanedCIs = await knex('configuration_items')
      .where('tenant', tenant)
      .whereNotExists(function() {
        this.select('*')
          .from('ci_relationships')
          .where('tenant', tenant)
          .whereRaw('source_ci_id = configuration_items.ci_id OR target_ci_id = configuration_items.ci_id');
      })
      .count('* as count');

    const completenessScore = totalCount > 0 ? (cisWithAllRequiredFields[0].count as number / totalCount) * 100 : 100;
    const duplicateIssuesScore = 100 - ((duplicateCIs[0][0].count / Math.max(1, totalCount)) * 100);
    const relationshipScore = totalCount > 0 ? 100 - ((orphanedCIs[0].count as number / totalCount) * 100) : 100;

    const score = (completenessScore + duplicateIssuesScore + relationshipScore) / 3;

    return {
      score: Math.round(score),
      details: {
        total_cis: totalCount,
        completeness_score: Math.round(completenessScore),
        duplicate_issues: duplicateCIs[0][0].count,
        orphaned_cis: orphanedCIs[0].count,
        relationship_coverage: Math.round(relationshipScore)
      },
      recommendations: this.generateDataQualityRecommendations(completenessScore, duplicateIssuesScore, relationshipScore)
    };
  }

  private async assessAuditTrailCompliance(tenant: string): Promise<any> {
    const totalAuditEntries = await knex('cmdb_audit_log').where('tenant', tenant).count('* as count');
    const totalCount = totalAuditEntries[0].count as number;

    const validatedEntries = await knex('cmdb_audit_log')
      .where('tenant', tenant)
      .where('validated', true)
      .count('* as count');

    const recentAuditEntries = await knex('cmdb_audit_log')
      .where('tenant', tenant)
      .where('performed_date', '>', knex.raw('NOW() - INTERVAL 30 DAY'))
      .count('* as count');

    const auditEntriesWithContext = await knex('cmdb_audit_log')
      .where('tenant', tenant)
      .whereNotNull('change_reason')
      .count('* as count');

    const validationCompliance = totalCount > 0 ? (validatedEntries[0].count as number / totalCount) * 100 : 100;
    const recentActivityCompliance = recentAuditEntries[0].count > 0 ? 100 : 0;
    const contextCompliance = totalCount > 0 ? (auditEntriesWithContext[0].count as number / totalCount) * 100 : 100;

    const score = (validationCompliance + recentActivityCompliance + contextCompliance) / 3;

    return {
      score: Math.round(score),
      details: {
        total_audit_entries: totalCount,
        validation_compliance: Math.round(validationCompliance),
        recent_activity_compliance: Math.round(recentActivityCompliance),
        context_compliance: Math.round(contextCompliance),
        entries_last_30_days: recentAuditEntries[0].count
      },
      recommendations: this.generateAuditTrailRecommendations(validationCompliance, recentActivityCompliance, contextCompliance)
    };
  }

  private async assessIncidentManagementCompliance(tenant: string): Promise<any> {
    const totalIncidents = await knex('tickets')
      .where('tenant', tenant)
      .where('ticket_type', 'incident')
      .count('* as count');
    const totalCount = totalIncidents[0].count as number;

    const incidentsWithCIs = await knex('tickets')
      .where('tenant', tenant)
      .where('ticket_type', 'incident')
      .whereNotNull('affected_ci_ids')
      .count('* as count');

    const incidentsWithImpactAnalysis = await knex('impact_analysis')
      .where('tenant', tenant)
      .where('trigger_type', 'incident')
      .count('* as count');

    const ciLinkageCompliance = totalCount > 0 ? (incidentsWithCIs[0].count as number / totalCount) * 100 : 100;
    const impactAnalysisCompliance = totalCount > 0 ? (incidentsWithImpactAnalysis[0].count as number / totalCount) * 50 : 100;

    const score = (ciLinkageCompliance + impactAnalysisCompliance) / 2;

    return {
      score: Math.round(score),
      details: {
        total_incidents: totalCount,
        ci_linkage_compliance: Math.round(ciLinkageCompliance),
        impact_analysis_compliance: Math.round(impactAnalysisCompliance)
      },
      recommendations: []
    };
  }

  private async assessProblemManagementCompliance(tenant: string): Promise<any> {
    const totalProblems = await knex('problem_records').where('tenant', tenant).count('* as count');
    const totalCount = totalProblems[0].count as number;

    const problemsWithRootCause = await knex('problem_records')
      .where('tenant', tenant)
      .whereNotNull('root_cause')
      .count('* as count');

    const problemsWithKEDB = await knex('problem_records')
      .where('tenant', tenant)
      .where('kedb_created', true)
      .count('* as count');

    const rootCauseCompliance = totalCount > 0 ? (problemsWithRootCause[0].count as number / totalCount) * 100 : 100;
    const kedbCompliance = totalCount > 0 ? (problemsWithKEDB[0].count as number / totalCount) * 100 : 100;

    const score = (rootCauseCompliance + kedbCompliance) / 2;

    return {
      score: Math.round(score),
      details: {
        total_problems: totalCount,
        root_cause_compliance: Math.round(rootCauseCompliance),
        kedb_compliance: Math.round(kedbCompliance)
      },
      recommendations: []
    };
  }

  private async assessServiceLevelManagementCompliance(tenant: string): Promise<any> {
    const totalSLAs = await knex('service_level_agreements').where('tenant', tenant).count('* as count');
    const totalCount = totalSLAs[0].count as number;

    const activeSLAs = await knex('service_level_agreements')
      .where('tenant', tenant)
      .where('status', 'active')
      .count('* as count');

    const slaBreaches = await knex('sla_breaches')
      .where('tenant', tenant)
      .where('breach_date', '>', knex.raw('NOW() - INTERVAL 30 DAY'))
      .count('* as count');

    const activeCompliance = totalCount > 0 ? (activeSLAs[0].count as number / totalCount) * 100 : 100;
    const breachCompliance = 100 - Math.min(100, (slaBreaches[0].count as number) * 10);

    const score = (activeCompliance + breachCompliance) / 2;

    return {
      score: Math.round(score),
      details: {
        total_slas: totalCount,
        active_slas: activeSLAs[0].count,
        recent_breaches: slaBreaches[0].count,
        active_compliance: Math.round(activeCompliance),
        breach_compliance: Math.round(breachCompliance)
      },
      recommendations: []
    };
  }

  private async generateSOXComplianceReport(tenant: string): Promise<any> {
    return {
      data_integrity: await this.assessDataIntegritySOX(tenant),
      access_controls: await this.assessAccessControlsSOX(tenant),
      change_controls: await this.assessChangeControlsSOX(tenant),
      documentation: await this.assessDocumentationSOX(tenant)
    };
  }

  private async generateISO20000ComplianceReport(tenant: string): Promise<any> {
    return {
      service_management_system: await this.assessServiceManagementSystem(tenant),
      planning_implementing: await this.assessPlanningImplementing(tenant),
      service_design_transition: await this.assessServiceDesignTransition(tenant),
      service_delivery: await this.assessServiceDelivery(tenant),
      relationship_processes: await this.assessRelationshipProcesses(tenant)
    };
  }

  private async generateCOBITComplianceReport(tenant: string): Promise<any> {
    return {
      governance: await this.assessGovernanceCOBIT(tenant),
      management: await this.assessManagementCOBIT(tenant),
      processes: await this.assessProcessesCOBIT(tenant)
    };
  }

  private async generateGenericComplianceReport(tenant: string): Promise<any> {
    return {
      configuration_management: await this.assessConfigurationManagementCompliance(tenant),
      data_quality: await this.assessDataQualityCompliance(tenant),
      audit_trail: await this.assessAuditTrailCompliance(tenant)
    };
  }

  private calculateOverallComplianceScore(sections: any): number {
    const scores: number[] = [];
    
    for (const sectionKey in sections) {
      if (sections[sectionKey] && typeof sections[sectionKey].score === 'number') {
        scores.push(sections[sectionKey].score);
      }
    }
    
    return scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  }

  private generateConfigurationManagementRecommendations(ownership: number, custodian: number, freshness: number, relationship: number): string[] {
    const recommendations: string[] = [];
    
    if (ownership < 95) {
      recommendations.push('Assign owners to all Configuration Items to ensure accountability');
    }
    if (custodian < 95) {
      recommendations.push('Assign custodians to all Configuration Items for day-to-day management');
    }
    if (freshness < 80) {
      recommendations.push('Implement regular CI review cycles to ensure data freshness');
    }
    if (relationship < 70) {
      recommendations.push('Map relationships between Configuration Items to understand dependencies');
    }
    
    return recommendations;
  }

  private generateChangeManagementRecommendations(authorization: number, impact: number, rollback: number): string[] {
    const recommendations: string[] = [];
    
    if (authorization < 95) {
      recommendations.push('Ensure all changes go through proper approval process');
    }
    if (impact < 80) {
      recommendations.push('Conduct impact analysis for all significant changes');
    }
    if (rollback < 85) {
      recommendations.push('Develop rollback plans for all changes to mitigate risks');
    }
    
    return recommendations;
  }

  private generateDataQualityRecommendations(completeness: number, duplicates: number, relationships: number): string[] {
    const recommendations: string[] = [];
    
    if (completeness < 90) {
      recommendations.push('Implement data validation rules to ensure completeness');
    }
    if (duplicates < 95) {
      recommendations.push('Establish duplicate detection and resolution processes');
    }
    if (relationships < 75) {
      recommendations.push('Improve relationship mapping to reduce orphaned CIs');
    }
    
    return recommendations;
  }

  private generateAuditTrailRecommendations(validation: number, activity: number, context: number): string[] {
    const recommendations: string[] = [];
    
    if (validation < 80) {
      recommendations.push('Implement audit entry validation processes');
    }
    if (activity < 90) {
      recommendations.push('Ensure regular CMDB activity to maintain audit trail');
    }
    if (context < 85) {
      recommendations.push('Provide context for all audit entries to improve traceability');
    }
    
    return recommendations;
  }

  private calculateFieldChanges(oldValues?: any, newValues?: any): Array<{ field_name: string; old_value: any; new_value: any }> {
    const changes: Array<{ field_name: string; old_value: any; new_value: any }> = [];
    
    if (!oldValues || !newValues) {
      return changes;
    }
    
    for (const field in newValues) {
      if (oldValues[field] !== newValues[field]) {
        changes.push({
          field_name: field,
          old_value: oldValues[field],
          new_value: newValues[field]
        });
      }
    }
    
    return changes;
  }

  // Placeholder methods for SOX, ISO20000, and COBIT assessments
  private async assessDataIntegritySOX(tenant: string): Promise<any> {
    return { score: 85, details: {}, recommendations: [] };
  }

  private async assessAccessControlsSOX(tenant: string): Promise<any> {
    return { score: 90, details: {}, recommendations: [] };
  }

  private async assessChangeControlsSOX(tenant: string): Promise<any> {
    return { score: 88, details: {}, recommendations: [] };
  }

  private async assessDocumentationSOX(tenant: string): Promise<any> {
    return { score: 82, details: {}, recommendations: [] };
  }

  private async assessServiceManagementSystem(tenant: string): Promise<any> {
    return { score: 87, details: {}, recommendations: [] };
  }

  private async assessPlanningImplementing(tenant: string): Promise<any> {
    return { score: 83, details: {}, recommendations: [] };
  }

  private async assessServiceDesignTransition(tenant: string): Promise<any> {
    return { score: 89, details: {}, recommendations: [] };
  }

  private async assessServiceDelivery(tenant: string): Promise<any> {
    return { score: 91, details: {}, recommendations: [] };
  }

  private async assessRelationshipProcesses(tenant: string): Promise<any> {
    return { score: 86, details: {}, recommendations: [] };
  }

  private async assessGovernanceCOBIT(tenant: string): Promise<any> {
    return { score: 84, details: {}, recommendations: [] };
  }

  private async assessManagementCOBIT(tenant: string): Promise<any> {
    return { score: 88, details: {}, recommendations: [] };
  }

  private async assessProcessesCOBIT(tenant: string): Promise<any> {
    return { score: 86, details: {}, recommendations: [] };
  }

  async getComplianceMetrics(tenant: string, timeFrame: number = 30): Promise<any> {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - (timeFrame * 24 * 60 * 60 * 1000));

    const auditEntries = await knex('cmdb_audit_log')
      .where('tenant', tenant)
      .whereBetween('performed_date', [startDate, endDate])
      .select('action', 'entity_type', 'change_reason', 'validated');

    const metrics = {
      total_changes: auditEntries.length,
      validated_changes: auditEntries.filter(e => e.validated).length,
      by_entity_type: {},
      by_action: {},
      by_change_reason: {},
      validation_rate: 0
    };

    // Count by entity type
    auditEntries.forEach(entry => {
      metrics.by_entity_type[entry.entity_type] = (metrics.by_entity_type[entry.entity_type] || 0) + 1;
      metrics.by_action[entry.action] = (metrics.by_action[entry.action] || 0) + 1;
      
      if (entry.change_reason) {
        metrics.by_change_reason[entry.change_reason] = (metrics.by_change_reason[entry.change_reason] || 0) + 1;
      }
    });

    metrics.validation_rate = metrics.total_changes > 0 ? 
      Math.round((metrics.validated_changes / metrics.total_changes) * 100) : 100;

    return metrics;
  }
}