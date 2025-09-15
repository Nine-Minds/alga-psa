import { IImpactAnalysis, IConfigurationItem, ICIRelationship } from '../../interfaces/cmdb.interfaces';
import { IChangeRequest } from '../../interfaces/change.interfaces';
import { knex } from '../db';
import { CMDBService } from './cmdbService';
import { v4 as uuidv4 } from 'uuid';

export class ImpactAnalysisService {
  private cmdbService: CMDBService;

  constructor() {
    this.cmdbService = new CMDBService(knex);
  }

  async analyzeChangeImpact(
    changeRequestId: string,
    sourceCIIds: string[],
    analysisDirection: 'upstream' | 'downstream' | 'both' = 'downstream',
    maxDepth: number = 5,
    performedBy: string
  ): Promise<IImpactAnalysis> {
    const startTime = Date.now();
    const changeRequest = await this.getChangeRequest(changeRequestId);
    
    const analysis: IImpactAnalysis = {
      analysis_id: uuidv4(),
      tenant: changeRequest.tenant || '',
      trigger_type: 'change_request',
      trigger_id: changeRequestId,
      source_ci_ids: sourceCIIds,
      analysis_direction: analysisDirection,
      max_depth: maxDepth,
      impacted_cis: [],
      total_impacted: 0,
      critical_impact_count: 0,
      high_impact_count: 0,
      medium_impact_count: 0,
      low_impact_count: 0,
      affected_services: [],
      affected_users_estimate: 0,
      estimated_downtime_minutes: 0,
      financial_impact_estimate: 0,
      recommendations: [],
      analysis_date: new Date(),
      analysis_duration_ms: 0,
      analyzer: 'automated',
      performed_by: performedBy,
      status: 'in_progress',
      confidence_score: 0
    };

    try {
      for (const sourceCIId of sourceCIIds) {
        const impactedCIs = await this.findImpactedCIs(
          sourceCIId,
          analysisDirection,
          maxDepth,
          changeRequest.tenant || ''
        );
        
        for (const impactedCI of impactedCIs) {
          const existingIndex = analysis.impacted_cis.findIndex(ci => ci.ci_id === impactedCI.ci_id);
          
          if (existingIndex === -1) {
            analysis.impacted_cis.push(impactedCI);
          } else {
            if (this.getImpactSeverityValue(impactedCI.impact_severity) > 
                this.getImpactSeverityValue(analysis.impacted_cis[existingIndex].impact_severity)) {
              analysis.impacted_cis[existingIndex] = impactedCI;
            }
          }
        }
      }

      await this.calculateImpactSummary(analysis);
      await this.assessBusinessImpact(analysis, changeRequest);
      await this.generateRecommendations(analysis, changeRequest);
      
      analysis.total_impacted = analysis.impacted_cis.length;
      analysis.analysis_duration_ms = Date.now() - startTime;
      analysis.status = 'completed';
      analysis.confidence_score = this.calculateConfidenceScore(analysis);
      
    } catch (error) {
      analysis.status = 'failed';
      console.error('Impact analysis failed:', error);
    }

    await this.saveImpactAnalysis(analysis);
    return analysis;
  }

  async analyzeIncidentImpact(
    incidentId: string,
    affectedCIIds: string[],
    performedBy: string
  ): Promise<IImpactAnalysis> {
    const startTime = Date.now();
    const incident = await this.getIncident(incidentId);
    
    const analysis: IImpactAnalysis = {
      analysis_id: uuidv4(),
      tenant: incident.tenant,
      trigger_type: 'incident',
      trigger_id: incidentId,
      source_ci_ids: affectedCIIds,
      analysis_direction: 'both',
      max_depth: 3,
      impacted_cis: [],
      total_impacted: 0,
      critical_impact_count: 0,
      high_impact_count: 0,
      medium_impact_count: 0,
      low_impact_count: 0,
      affected_services: [],
      affected_users_estimate: 0,
      estimated_downtime_minutes: 0,
      recommendations: [],
      analysis_date: new Date(),
      analysis_duration_ms: 0,
      analyzer: 'automated',
      performed_by: performedBy,
      status: 'in_progress',
      confidence_score: 0
    };

    try {
      for (const ciId of affectedCIIds) {
        const impactedCIs = await this.findImpactedCIs(ciId, 'both', 3, incident.tenant);
        analysis.impacted_cis.push(...impactedCIs);
      }

      await this.calculateImpactSummary(analysis);
      await this.assessIncidentBusinessImpact(analysis, incident);
      await this.generateIncidentRecommendations(analysis, incident);
      
      analysis.total_impacted = analysis.impacted_cis.length;
      analysis.analysis_duration_ms = Date.now() - startTime;
      analysis.status = 'completed';
      analysis.confidence_score = this.calculateConfidenceScore(analysis);
      
    } catch (error) {
      analysis.status = 'failed';
      console.error('Incident impact analysis failed:', error);
    }

    await this.saveImpactAnalysis(analysis);
    return analysis;
  }

  private async findImpactedCIs(
    sourceCIId: string,
    direction: 'upstream' | 'downstream' | 'both',
    maxDepth: number,
    tenant: string,
    visited: Set<string> = new Set(),
    currentDepth: number = 0
  ): Promise<Array<{
    ci_id: string;
    ci_name: string;
    ci_type: string;
    impact_level: 'direct' | 'indirect';
    impact_severity: 'critical' | 'high' | 'medium' | 'low';
    relationship_path: string[];
    business_impact: string;
    technical_impact: string;
  }>> {
    
    if (currentDepth >= maxDepth || visited.has(sourceCIId)) {
      return [];
    }
    
    visited.add(sourceCIId);
    const impactedCIs: any[] = [];
    
    let relationshipsQuery = knex('ci_relationships as cr')
      .join('configuration_items as ci', function(this: any) {
        this.on('ci.ci_id', 'cr.target_ci_id')
            .orOn('ci.ci_id', 'cr.source_ci_id');
      })
      .where('cr.tenant', tenant)
      .where('cr.status', 'active')
      .where(function(this: any) {
        if (direction === 'downstream' || direction === 'both') {
          this.where('cr.source_ci_id', sourceCIId);
        }
        if (direction === 'upstream' || direction === 'both') {
          this.orWhere('cr.target_ci_id', sourceCIId);
        }
      })
      .whereNot('ci.ci_id', sourceCIId)
      .select([
        'ci.*',
        'cr.relationship_type',
        'cr.criticality',
        'cr.strength',
        'cr.source_ci_id',
        'cr.target_ci_id'
      ]);

    const relationships = await relationshipsQuery;
    
    for (const rel of relationships) {
      const isDownstream = rel.source_ci_id === sourceCIId;
      const impactSeverity = this.calculateImpactSeverity(rel, currentDepth);
      const businessImpact = await this.assessCIBusinessImpact(rel);
      const technicalImpact = this.assessTechnicalImpact(rel);
      
      const impactedCI = {
        ci_id: rel.ci_id,
        ci_name: rel.ci_name,
        ci_type: rel.ci_type,
        impact_level: currentDepth === 0 ? 'direct' as const : 'indirect' as const,
        impact_severity: impactSeverity,
        relationship_path: [rel.relationship_type],
        business_impact: businessImpact,
        technical_impact: technicalImpact
      };
      
      impactedCIs.push(impactedCI);
      
      const nestedImpacts = await this.findImpactedCIs(
        rel.ci_id,
        direction,
        maxDepth,
        tenant,
        visited,
        currentDepth + 1
      );
      
      for (const nestedImpact of nestedImpacts) {
        nestedImpact.relationship_path = [rel.relationship_type, ...nestedImpact.relationship_path];
        impactedCIs.push(nestedImpact);
      }
    }
    
    return impactedCIs;
  }

  private calculateImpactSeverity(
    relationship: any,
    depth: number
  ): 'critical' | 'high' | 'medium' | 'low' {
    let severityScore = 0;
    
    switch (relationship.business_criticality) {
      case 'very_high': severityScore += 5; break;
      case 'high': severityScore += 4; break;
      case 'medium': severityScore += 3; break;
      case 'low': severityScore += 2; break;
      case 'very_low': severityScore += 1; break;
    }
    
    switch (relationship.criticality) {
      case 'critical': severityScore += 4; break;
      case 'important': severityScore += 3; break;
      case 'normal': severityScore += 2; break;
      case 'low': severityScore += 1; break;
    }
    
    switch (relationship.strength) {
      case 'strong': severityScore += 3; break;
      case 'medium': severityScore += 2; break;
      case 'weak': severityScore += 1; break;
    }
    
    if (relationship.environment === 'production') severityScore += 2;
    
    severityScore -= depth;
    
    if (severityScore >= 10) return 'critical';
    if (severityScore >= 7) return 'high';
    if (severityScore >= 4) return 'medium';
    return 'low';
  }

  private async assessCIBusinessImpact(ci: IConfigurationItem): Promise<string> {
    const impacts: string[] = [];
    
    if (ci.ci_type === 'service' && ci.environment === 'production') {
      impacts.push('Service disruption for end users');
    }
    
    if (ci.business_criticality === 'very_high' || ci.business_criticality === 'high') {
      impacts.push('Critical business process interruption');
    }
    
    if (ci.ci_type === 'database' || ci.ci_type === 'application') {
      impacts.push('Data access limitations');
    }
    
    if (ci.ci_type === 'network' || ci.ci_type === 'infrastructure') {
      impacts.push('Connectivity issues affecting multiple services');
    }
    
    return impacts.length > 0 ? impacts.join('; ') : 'Minimal business impact expected';
  }

  private assessTechnicalImpact(ci: IConfigurationItem): string {
    const impacts: string[] = [];
    
    if (ci.ci_type === 'server' || ci.ci_type === 'virtual_machine') {
      impacts.push('System downtime and potential data loss');
    }
    
    if (ci.ci_type === 'network') {
      impacts.push('Network connectivity disruption');
    }
    
    if (ci.ci_type === 'application') {
      impacts.push('Application functionality degradation');
    }
    
    if (ci.ci_type === 'database') {
      impacts.push('Data consistency and availability issues');
    }
    
    return impacts.length > 0 ? impacts.join('; ') : 'Limited technical impact';
  }

  private async calculateImpactSummary(analysis: IImpactAnalysis): Promise<void> {
    analysis.critical_impact_count = analysis.impacted_cis.filter(ci => ci.impact_severity === 'critical').length;
    analysis.high_impact_count = analysis.impacted_cis.filter(ci => ci.impact_severity === 'high').length;
    analysis.medium_impact_count = analysis.impacted_cis.filter(ci => ci.impact_severity === 'medium').length;
    analysis.low_impact_count = analysis.impacted_cis.filter(ci => ci.impact_severity === 'low').length;
    
    const services = analysis.impacted_cis.filter(ci => ci.ci_type === 'service');
    analysis.affected_services = services.map(service => service.ci_name);
  }

  private async assessBusinessImpact(analysis: IImpactAnalysis, changeRequest: IChangeRequest): Promise<void> {
    let userImpactEstimate = 0;
    let downtimeEstimate = 0;
    let financialImpact = 0;
    
    for (const ci of analysis.impacted_cis) {
      if (ci.ci_type === 'service') {
        switch (ci.impact_severity) {
          case 'critical':
            userImpactEstimate += 1000;
            downtimeEstimate += 60;
            financialImpact += 50000;
            break;
          case 'high':
            userImpactEstimate += 500;
            downtimeEstimate += 30;
            financialImpact += 25000;
            break;
          case 'medium':
            userImpactEstimate += 100;
            downtimeEstimate += 15;
            financialImpact += 10000;
            break;
          case 'low':
            userImpactEstimate += 10;
            downtimeEstimate += 5;
            financialImpact += 1000;
            break;
        }
      }
    }
    
    if (changeRequest.change_type === 'emergency') {
      downtimeEstimate *= 0.5;
    }
    
    analysis.affected_users_estimate = userImpactEstimate;
    analysis.estimated_downtime_minutes = downtimeEstimate;
    analysis.financial_impact_estimate = financialImpact;
  }

  private async assessIncidentBusinessImpact(analysis: IImpactAnalysis, incident: any): Promise<void> {
    let userImpactEstimate = 0;
    let downtimeEstimate = 120; // Base estimate for incidents
    
    for (const ci of analysis.impacted_cis) {
      switch (ci.impact_severity) {
        case 'critical':
          userImpactEstimate += 2000;
          downtimeEstimate += 60;
          break;
        case 'high':
          userImpactEstimate += 1000;
          downtimeEstimate += 30;
          break;
        case 'medium':
          userImpactEstimate += 200;
          downtimeEstimate += 15;
          break;
        case 'low':
          userImpactEstimate += 20;
          break;
      }
    }
    
    analysis.affected_users_estimate = userImpactEstimate;
    analysis.estimated_downtime_minutes = downtimeEstimate;
  }

  private async generateRecommendations(analysis: IImpactAnalysis, changeRequest: IChangeRequest): Promise<void> {
    const recommendations: Array<{
      type: 'preparation' | 'communication' | 'mitigation';
      priority: 'high' | 'medium' | 'low';
      description: string;
      actions: string[];
    }> = [];
    
    if (analysis.critical_impact_count > 0) {
      recommendations.push({
        type: 'preparation' as const,
        priority: 'high' as const,
        description: 'Critical systems will be impacted. Ensure comprehensive rollback plan is prepared.',
        actions: [
          'Create detailed rollback procedures',
          'Prepare emergency contact list',
          'Schedule additional technical resources',
          'Consider emergency change approval if not already obtained'
        ]
      });
    }
    
    if (analysis.high_impact_count + analysis.critical_impact_count > 5) {
      recommendations.push({
        type: 'communication' as const,
        priority: 'high' as const,
        description: 'Multiple high-impact systems affected. Extensive communication required.',
        actions: [
          'Notify all affected service owners',
          'Prepare customer communication templates',
          'Schedule change announcement',
          'Set up incident response bridge if needed'
        ]
      });
    }
    
    if (analysis.estimated_downtime_minutes > 60) {
      recommendations.push({
        type: 'mitigation' as const,
        priority: 'medium' as const,
        description: 'Significant downtime expected. Consider mitigation strategies.',
        actions: [
          'Evaluate staging the change during maintenance windows',
          'Consider blue-green deployment strategies',
          'Prepare service degradation notices',
          'Review capacity planning for failover systems'
        ]
      });
    }
    
    if (changeRequest.change_type === 'standard' && analysis.critical_impact_count > 0) {
      recommendations.push({
        type: 'preparation' as const,
        priority: 'medium' as const,
        description: 'Standard change with critical impact should be reviewed for risk classification.',
        actions: [
          'Consider reclassifying as normal change',
          'Review change approval requirements',
          'Validate testing procedures'
        ]
      });
    }
    
    analysis.recommendations = recommendations;
  }

  private async generateIncidentRecommendations(analysis: IImpactAnalysis, incident: any): Promise<void> {
    const recommendations: Array<{
      type: 'preparation' | 'communication' | 'mitigation';
      priority: 'high' | 'medium' | 'low';
      description: string;
      actions: string[];
    }> = [];
    
    if (analysis.critical_impact_count > 0) {
      recommendations.push({
        type: 'mitigation' as const,
        priority: 'high' as const,
        description: 'Critical systems are impacted. Immediate action required.',
        actions: [
          'Activate major incident procedures',
          'Engage service owners immediately',
          'Consider invoking disaster recovery procedures',
          'Escalate to senior management if needed'
        ]
      });
    }
    
    if (analysis.affected_services.length > 3) {
      recommendations.push({
        type: 'communication' as const,
        priority: 'high' as const,
        description: 'Multiple services affected. Coordinate communication efforts.',
        actions: [
          'Establish central communication hub',
          'Notify all affected customers',
          'Update service status pages',
          'Coordinate with external vendors if applicable'
        ]
      });
    }
    
    recommendations.push({
      type: 'preparation' as const,
      priority: 'medium' as const,
      description: 'Document impact analysis for post-incident review.',
      actions: [
        'Capture current impact assessment',
        'Track resolution progress against impacted CIs',
        'Prepare for post-incident review meeting'
      ]
    });
    
    analysis.recommendations = recommendations;
  }

  private calculateConfidenceScore(analysis: IImpactAnalysis): number {
    let score = 70; // Base confidence
    
    if (analysis.impacted_cis.length > 0) score += 10;
    
    if (analysis.analysis_duration_ms < 30000) score += 10;
    
    if (analysis.recommendations.length > 0) score += 10;
    
    const criticalAndHighCount = analysis.critical_impact_count + analysis.high_impact_count;
    if (criticalAndHighCount > 0 && criticalAndHighCount < 10) {
      score += 5;
    } else if (criticalAndHighCount >= 10) {
      score -= 5;
    }
    
    return Math.min(100, Math.max(0, score));
  }

  private getImpactSeverityValue(severity: 'critical' | 'high' | 'medium' | 'low'): number {
    switch (severity) {
      case 'critical': return 4;
      case 'high': return 3;
      case 'medium': return 2;
      case 'low': return 1;
      default: return 0;
    }
  }

  private async getChangeRequest(changeRequestId: string): Promise<IChangeRequest> {
    const result = await knex('change_requests').where('change_request_id', changeRequestId).first();
    if (!result) throw new Error(`Change request ${changeRequestId} not found`);
    return result;
  }

  private async getIncident(incidentId: string): Promise<any> {
    const result = await knex('tickets').where('ticket_id', incidentId).first();
    if (!result) throw new Error(`Incident ${incidentId} not found`);
    return result;
  }

  private async saveImpactAnalysis(analysis: IImpactAnalysis): Promise<void> {
    await knex('impact_analysis').insert({
      ...analysis,
      source_ci_ids: JSON.stringify(analysis.source_ci_ids),
      impacted_cis: JSON.stringify(analysis.impacted_cis),
      affected_services: JSON.stringify(analysis.affected_services),
      recommendations: JSON.stringify(analysis.recommendations)
    });
  }

  async getImpactAnalysisHistory(trigger_type: string, trigger_id: string): Promise<IImpactAnalysis[]> {
    const results = await knex('impact_analysis')
      .where('trigger_type', trigger_type)
      .where('trigger_id', trigger_id)
      .orderBy('analysis_date', 'desc');

    return results.map((result: any) => ({
      ...result,
      source_ci_ids: JSON.parse(result.source_ci_ids),
      impacted_cis: JSON.parse(result.impacted_cis),
      affected_services: JSON.parse(result.affected_services),
      recommendations: JSON.parse(result.recommendations)
    }));
  }

  async generateImpactReport(tenant: string, startDate: Date, endDate: Date): Promise<any> {
    const analyses = await knex('impact_analysis')
      .where('tenant', tenant)
      .whereBetween('analysis_date', [startDate, endDate])
      .where('status', 'completed');

    const report = {
      period: { start: startDate, end: endDate },
      total_analyses: analyses.length,
      by_trigger_type: {},
      average_confidence_score: 0,
      most_impacted_ci_types: {},
      total_estimated_downtime: 0,
      total_financial_impact: 0
    };

    let totalConfidence = 0;
    let totalDowntime = 0;
    let totalFinancial = 0;
    const ciTypeCounts: { [key: string]: number } = {};
    const triggerTypeCounts: { [key: string]: number } = {};

    for (const analysis of analyses) {
      const impactedCIs = JSON.parse(analysis.impacted_cis || '[]');
      
      triggerTypeCounts[analysis.trigger_type] = (triggerTypeCounts[analysis.trigger_type] || 0) + 1;
      
      totalConfidence += analysis.confidence_score || 0;
      totalDowntime += analysis.estimated_downtime_minutes || 0;
      totalFinancial += analysis.financial_impact_estimate || 0;
      
      for (const ci of impactedCIs) {
        ciTypeCounts[ci.ci_type] = (ciTypeCounts[ci.ci_type] || 0) + 1;
      }
    }

    report.by_trigger_type = triggerTypeCounts;
    report.average_confidence_score = analyses.length > 0 ? totalConfidence / analyses.length : 0;
    report.most_impacted_ci_types = ciTypeCounts;
    report.total_estimated_downtime = totalDowntime;
    report.total_financial_impact = totalFinancial;

    return report;
  }
}