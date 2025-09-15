import { Knex } from 'knex';
import { IChangeRequest, RiskLevel } from '../../interfaces/change.interfaces';
import { getCurrentTenantId } from '../db';

/**
 * Risk Assessment Matrix for Change Management
 */
interface RiskFactor {
  name: string;
  weight: number; // 1-10 scale
  assess: (change: Partial<IChangeRequest>) => number; // Returns 1-5 score
}

/**
 * Impact categories for assessment
 */
interface ImpactCategory {
  name: string;
  description: string;
  assessmentCriteria: string[];
}

/**
 * Change Risk Assessment Service
 * Implements ITIL risk assessment methodologies for change management
 */
export class ChangeRiskAssessmentService {
  constructor(private knex: Knex) {}

  /**
   * Perform comprehensive risk assessment for a change request
   */
  async assessChangeRisk(changeData: Partial<IChangeRequest>): Promise<{
    overallRiskLevel: RiskLevel;
    riskScore: number;
    factorScores: Record<string, number>;
    recommendations: string[];
    mitigationStrategies: string[];
  }> {
    try {
      const riskFactors = this.getRiskFactors();
      const factorScores: Record<string, number> = {};
      let totalWeightedScore = 0;
      let totalWeight = 0;

      // Assess each risk factor
      for (const factor of riskFactors) {
        const score = factor.assess(changeData);
        factorScores[factor.name] = score;
        totalWeightedScore += score * factor.weight;
        totalWeight += factor.weight;
      }

      // Calculate overall risk score (1-5 scale)
      const riskScore = totalWeightedScore / totalWeight;
      const overallRiskLevel = this.mapScoreToRiskLevel(riskScore);

      // Generate recommendations and mitigation strategies
      const recommendations = this.generateRecommendations(factorScores, overallRiskLevel);
      const mitigationStrategies = this.generateMitigationStrategies(factorScores, changeData);

      return {
        overallRiskLevel,
        riskScore,
        factorScores,
        recommendations,
        mitigationStrategies
      };
    } catch (error) {
      console.error('Error assessing change risk:', error);
      throw error;
    }
  }

  /**
   * Perform business impact analysis
   */
  async assessBusinessImpact(changeData: Partial<IChangeRequest>): Promise<{
    impactLevel: 'very_low' | 'low' | 'medium' | 'high' | 'very_high';
    impactScore: number;
    categoryScores: Record<string, number>;
    affectedAreas: string[];
    financialImpact: {
      estimatedCost: number;
      potentialLoss: number;
      roi: number;
    };
  }> {
    try {
      const impactCategories = this.getImpactCategories();
      const categoryScores: Record<string, number> = {};
      let totalScore = 0;

      // Assess impact in each category
      for (const category of impactCategories) {
        const score = await this.assessCategoryImpact(changeData, category);
        categoryScores[category.name] = score;
        totalScore += score;
      }

      const impactScore = totalScore / impactCategories.length;
      const impactLevel = this.mapScoreToImpactLevel(impactScore);

      // Identify affected areas
      const affectedAreas = await this.identifyAffectedAreas(changeData);

      // Calculate financial impact
      const financialImpact = await this.calculateFinancialImpact(changeData);

      return {
        impactLevel,
        impactScore,
        categoryScores,
        affectedAreas,
        financialImpact
      };
    } catch (error) {
      console.error('Error assessing business impact:', error);
      throw error;
    }
  }

  /**
   * Get risk factors for assessment
   */
  private getRiskFactors(): RiskFactor[] {
    return [
      {
        name: 'Technical Complexity',
        weight: 9,
        assess: (change) => {
          if (!change.implementation_plan) return 3;
          
          const plan = change.implementation_plan.toLowerCase();
          
          // Very complex: Database schema changes, system integration, multi-component changes
          if (plan.includes('database schema') || plan.includes('integration') || plan.includes('migration')) {
            return 5;
          }
          // High complexity: Configuration changes across multiple systems
          if (plan.includes('multiple systems') || plan.includes('configuration')) {
            return 4;
          }
          // Medium complexity: Single system changes
          if (plan.includes('restart') || plan.includes('update')) {
            return 3;
          }
          // Low complexity: Minor configuration or software updates
          if (plan.includes('patch') || plan.includes('minor')) {
            return 2;
          }
          // Very low: Documented standard procedures
          return 1;
        }
      },
      {
        name: 'System Criticality',
        weight: 10,
        assess: (change) => {
          if (!change.affected_services || change.affected_services.length === 0) return 2;
          
          // Check if any critical services are affected
          const criticalServices = ['production-database', 'payment-system', 'authentication'];
          const affectedCritical = change.affected_services.some(service => 
            criticalServices.some(critical => service.toLowerCase().includes(critical))
          );
          
          if (affectedCritical) return 5;
          if (change.affected_services.length > 5) return 4;
          if (change.affected_services.length > 2) return 3;
          return 2;
        }
      },
      {
        name: 'Timing and Urgency',
        weight: 7,
        assess: (change) => {
          if (change.emergency_change) return 5;
          
          if (!change.requested_implementation_date) return 2;
          
          const requestedDate = new Date(change.requested_implementation_date);
          const now = new Date();
          const daysUntilImplementation = (requestedDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
          
          if (daysUntilImplementation < 1) return 5;
          if (daysUntilImplementation < 3) return 4;
          if (daysUntilImplementation < 7) return 3;
          if (daysUntilImplementation < 14) return 2;
          return 1;
        }
      },
      {
        name: 'Rollback Capability',
        weight: 8,
        assess: (change) => {
          if (!change.backout_plan) return 5;
          
          const backoutPlan = change.backout_plan.toLowerCase();
          
          // No rollback possible (data destruction, irreversible changes)
          if (backoutPlan.includes('irreversible') || backoutPlan.includes('no rollback')) {
            return 5;
          }
          // Difficult rollback (manual processes, data restore required)
          if (backoutPlan.includes('manual') || backoutPlan.includes('restore')) {
            return 4;
          }
          // Moderate rollback complexity
          if (backoutPlan.includes('complex') || backoutPlan.includes('multiple steps')) {
            return 3;
          }
          // Easy rollback (automated, single action)
          if (backoutPlan.includes('automated') || backoutPlan.includes('single')) {
            return 2;
          }
          return 1;
        }
      },
      {
        name: 'Testing Coverage',
        weight: 8,
        assess: (change) => {
          if (!change.test_plan) return 5;
          
          const testPlan = change.test_plan.toLowerCase();
          
          // Comprehensive testing (unit, integration, UAT, performance)
          if (testPlan.includes('comprehensive') || testPlan.includes('full suite')) {
            return 1;
          }
          // Good testing coverage
          if (testPlan.includes('integration') && testPlan.includes('user acceptance')) {
            return 2;
          }
          // Basic testing
          if (testPlan.includes('basic') || testPlan.includes('functional')) {
            return 3;
          }
          // Limited testing
          if (testPlan.includes('limited') || testPlan.includes('minimal')) {
            return 4;
          }
          return 5;
        }
      },
      {
        name: 'Resource Availability',
        weight: 6,
        assess: (change) => {
          // This would typically check actual resource calendars and availability
          // For now, we'll base it on change timing and emergency flags
          
          if (change.emergency_change) return 4; // Resources may not be optimal for emergency
          
          // Check if implementation is during business hours (higher risk)
          if (change.scheduled_start_date) {
            const startDate = new Date(change.scheduled_start_date);
            const hour = startDate.getHours();
            const dayOfWeek = startDate.getDay();
            
            // Business hours (9 AM - 5 PM, Monday-Friday)
            if (dayOfWeek >= 1 && dayOfWeek <= 5 && hour >= 9 && hour <= 17) {
              return 4;
            }
            // Evening/weekend
            return 2;
          }
          
          return 3; // Default moderate risk
        }
      },
      {
        name: 'Change Frequency',
        weight: 5,
        assess: (change) => {
          // This would check historical change frequency for affected services
          // Higher frequency = higher risk due to change fatigue and system instability
          
          if (change.affected_services && change.affected_services.length > 0) {
            // This would be calculated from historical data
            // For now, return moderate risk
            return 3;
          }
          
          return 2;
        }
      }
    ];
  }

  /**
   * Get impact assessment categories
   */
  private getImpactCategories(): ImpactCategory[] {
    return [
      {
        name: 'Service Availability',
        description: 'Impact on service uptime and availability',
        assessmentCriteria: [
          'Duration of service interruption',
          'Number of affected users',
          'Business criticality of affected services'
        ]
      },
      {
        name: 'Data Integrity',
        description: 'Risk to data consistency and integrity',
        assessmentCriteria: [
          'Data modification requirements',
          'Backup and recovery procedures',
          'Data validation processes'
        ]
      },
      {
        name: 'Security',
        description: 'Impact on system security posture',
        assessmentCriteria: [
          'Security control modifications',
          'Access control changes',
          'Vulnerability introduction risk'
        ]
      },
      {
        name: 'Performance',
        description: 'Impact on system performance',
        assessmentCriteria: [
          'Resource utilization changes',
          'Response time impact',
          'Throughput considerations'
        ]
      },
      {
        name: 'User Experience',
        description: 'Impact on end user experience',
        assessmentCriteria: [
          'UI/UX modifications',
          'Learning curve requirements',
          'Feature availability changes'
        ]
      },
      {
        name: 'Compliance',
        description: 'Impact on regulatory compliance',
        assessmentCriteria: [
          'Regulatory requirement changes',
          'Audit trail modifications',
          'Policy compliance impact'
        ]
      }
    ];
  }

  /**
   * Assess impact in a specific category
   */
  private async assessCategoryImpact(
    changeData: Partial<IChangeRequest>, 
    category: ImpactCategory
  ): Promise<number> {
    // This would implement category-specific assessment logic
    // For now, return a calculated value based on change characteristics
    
    let score = 1; // Start with low impact
    
    switch (category.name) {
      case 'Service Availability':
        if (changeData.affected_services && changeData.affected_services.length > 0) {
          score = Math.min(5, 1 + changeData.affected_services.length);
        }
        if (changeData.emergency_change) score = Math.min(5, score + 1);
        break;
        
      case 'Security':
        if (changeData.change_category === 'security') {
          score = 4; // Security changes inherently have high security impact
        } else if (changeData.affected_services?.some(s => s.includes('auth') || s.includes('security'))) {
          score = 5;
        }
        break;
        
      case 'Data Integrity':
        if (changeData.change_category === 'database') {
          score = 5;
        } else if (changeData.implementation_plan?.toLowerCase().includes('data')) {
          score = 3;
        }
        break;
        
      default:
        score = 2; // Default moderate impact
    }
    
    return Math.max(1, Math.min(5, score));
  }

  /**
   * Identify affected areas based on change data
   */
  private async identifyAffectedAreas(changeData: Partial<IChangeRequest>): Promise<string[]> {
    const affectedAreas: Set<string> = new Set();
    
    // Add areas based on affected services
    if (changeData.affected_services) {
      changeData.affected_services.forEach(service => {
        if (service.includes('web')) affectedAreas.add('Web Applications');
        if (service.includes('database')) affectedAreas.add('Database Systems');
        if (service.includes('network')) affectedAreas.add('Network Infrastructure');
        if (service.includes('auth')) affectedAreas.add('Authentication Services');
        if (service.includes('payment')) affectedAreas.add('Payment Systems');
      });
    }
    
    // Add areas based on change category
    switch (changeData.change_category) {
      case 'hardware':
        affectedAreas.add('Hardware Infrastructure');
        break;
      case 'network':
        affectedAreas.add('Network Infrastructure');
        break;
      case 'security':
        affectedAreas.add('Security Systems');
        break;
      case 'application':
        affectedAreas.add('Application Layer');
        break;
    }
    
    return Array.from(affectedAreas);
  }

  /**
   * Calculate financial impact
   */
  private async calculateFinancialImpact(changeData: Partial<IChangeRequest>): Promise<{
    estimatedCost: number;
    potentialLoss: number;
    roi: number;
  }> {
    // This would integrate with financial systems and historical data
    // For now, provide estimates based on change characteristics
    
    let estimatedCost = 1000; // Base cost
    let potentialLoss = 0;
    
    // Adjust cost based on change type and complexity
    switch (changeData.change_type) {
      case 'emergency':
        estimatedCost *= 3; // Emergency changes cost more
        break;
      case 'normal':
        estimatedCost *= 1.5;
        break;
    }
    
    // Adjust based on affected services
    if (changeData.affected_services) {
      estimatedCost += changeData.affected_services.length * 500;
      
      // Calculate potential loss from downtime
      const criticalServices = changeData.affected_services.filter(s => 
        s.includes('payment') || s.includes('production') || s.includes('critical')
      );
      potentialLoss = criticalServices.length * 10000; // $10k per critical service hour
    }
    
    // Simple ROI calculation (this would be more sophisticated in practice)
    const roi = potentialLoss > 0 ? (potentialLoss - estimatedCost) / estimatedCost * 100 : 0;
    
    return {
      estimatedCost,
      potentialLoss,
      roi
    };
  }

  /**
   * Map risk score to risk level
   */
  private mapScoreToRiskLevel(score: number): RiskLevel {
    if (score >= 4.5) return RiskLevel.VERY_HIGH;
    if (score >= 3.5) return RiskLevel.HIGH;
    if (score >= 2.5) return RiskLevel.MEDIUM;
    if (score >= 1.5) return RiskLevel.LOW;
    return RiskLevel.VERY_LOW;
  }

  /**
   * Map score to impact level
   */
  private mapScoreToImpactLevel(score: number): 'very_low' | 'low' | 'medium' | 'high' | 'very_high' {
    if (score >= 4.5) return 'very_high';
    if (score >= 3.5) return 'high';
    if (score >= 2.5) return 'medium';
    if (score >= 1.5) return 'low';
    return 'very_low';
  }

  /**
   * Generate recommendations based on risk assessment
   */
  private generateRecommendations(factorScores: Record<string, number>, riskLevel: RiskLevel): string[] {
    const recommendations: string[] = [];
    
    // General recommendations based on risk level
    switch (riskLevel) {
      case RiskLevel.VERY_HIGH:
        recommendations.push('Consider breaking this change into smaller, less risky components');
        recommendations.push('Require senior management approval');
        recommendations.push('Schedule during maintenance window with full team availability');
        break;
        
      case RiskLevel.HIGH:
        recommendations.push('Ensure comprehensive testing in non-production environment');
        recommendations.push('Have rollback plan ready and tested');
        recommendations.push('Consider implementation during low-usage period');
        break;
        
      case RiskLevel.MEDIUM:
        recommendations.push('Perform adequate testing before implementation');
        recommendations.push('Ensure monitoring is in place during implementation');
        break;
    }
    
    // Factor-specific recommendations
    if (factorScores['Technical Complexity'] >= 4) {
      recommendations.push('Consider peer review of implementation plan');
      recommendations.push('Ensure subject matter experts are available during implementation');
    }
    
    if (factorScores['Rollback Capability'] >= 4) {
      recommendations.push('Develop and test detailed rollback procedures');
      recommendations.push('Consider creating system backup before change');
    }
    
    if (factorScores['Testing Coverage'] >= 4) {
      recommendations.push('Enhance testing coverage before implementation');
      recommendations.push('Consider additional user acceptance testing');
    }
    
    return recommendations;
  }

  /**
   * Generate mitigation strategies
   */
  private generateMitigationStrategies(
    factorScores: Record<string, number>, 
    changeData: Partial<IChangeRequest>
  ): string[] {
    const strategies: string[] = [];
    
    // Risk-specific mitigation strategies
    if (factorScores['System Criticality'] >= 4) {
      strategies.push('Implement change during scheduled maintenance window');
      strategies.push('Ensure 24/7 support coverage during and after implementation');
      strategies.push('Set up enhanced monitoring and alerting');
    }
    
    if (factorScores['Technical Complexity'] >= 4) {
      strategies.push('Conduct implementation dry-run in test environment');
      strategies.push('Create detailed step-by-step implementation guide');
      strategies.push('Assign multiple technical resources to implementation team');
    }
    
    if (changeData.emergency_change) {
      strategies.push('Document all decisions and actions taken during emergency');
      strategies.push('Schedule post-implementation review within 48 hours');
      strategies.push('Consider temporary solution with planned permanent fix');
    }
    
    // General mitigation strategies
    strategies.push('Establish clear communication plan for stakeholders');
    strategies.push('Define success criteria and validation checkpoints');
    strategies.push('Prepare contingency plans for common failure scenarios');
    
    return strategies;
  }
}

export default ChangeRiskAssessmentService;