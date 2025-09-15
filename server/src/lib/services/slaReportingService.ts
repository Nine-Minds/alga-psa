import { Knex } from 'knex';
import { IServiceReport } from '../../interfaces/service.interfaces';

export interface IDashboardMetrics {
  overview: {
    totalServices: number;
    activeSLAs: number;
    overallCompliance: number;
    avgAvailability: number;
    avgResponseTime: number;
    totalIncidents: number;
    avgCSAT: number;
  };
  compliance: {
    compliant: number;
    warning: number;
    breach: number;
    critical: number;
  };
  trends: {
    availability: Array<{ date: string; value: number }>;
    responseTime: Array<{ date: string; value: number }>;
    incidents: Array<{ date: string; value: number }>;
    satisfaction: Array<{ date: string; value: number }>;
  };
  topIssues: Array<{
    service: string;
    issue: string;
    count: number;
    impact: 'high' | 'medium' | 'low';
  }>;
}

export interface IServiceLevelReport {
  reportId: string;
  reportType: 'executive' | 'operational' | 'tactical';
  generatedDate: Date;
  reportPeriod: {
    start: Date;
    end: Date;
  };
  sections: {
    executiveSummary?: {
      overallHealth: 'excellent' | 'good' | 'fair' | 'poor';
      keyMetrics: any;
      criticalIssues: string[];
      recommendations: string[];
    };
    slaPerformance?: {
      services: Array<{
        serviceName: string;
        availability: { actual: number; target: number; status: string };
        responseTime: { actual: number; target: number; status: string };
        resolutionTime: any;
        incidents: number;
        csatScore: number;
      }>;
    };
    incidentAnalysis?: {
      totalIncidents: number;
      byPriority: { [priority: string]: number };
      byCategory: { [category: string]: number };
      avgResolutionTime: number;
      escalationRate: number;
    };
    customerFeedback?: {
      overallSatisfaction: number;
      npsScore: number;
      feedbackThemes: Array<{ theme: string; frequency: number }>;
      improvementAreas: string[];
    };
    financialImpact?: {
      serviceCredits: number;
      penalties: number;
      costOfDowntime: number;
      preventedCosts: number;
    };
  };
}

export class SLAReportingService {
  constructor(private knex: Knex) {}

  /**
   * Generate comprehensive dashboard metrics
   */
  async generateDashboardMetrics(
    tenant: string,
    timeframe: {
      start: Date;
      end: Date;
    }
  ): Promise<IDashboardMetrics> {
    try {
      // Get overview metrics
      const overview = await this.getOverviewMetrics(tenant, timeframe);
      
      // Get compliance distribution
      const compliance = await this.getComplianceDistribution(tenant, timeframe);
      
      // Get trend data
      const trends = await this.getTrendData(tenant, timeframe);
      
      // Get top issues
      const topIssues = await this.getTopIssues(tenant, timeframe);

      return {
        overview,
        compliance,
        trends,
        topIssues
      };
    } catch (error) {
      console.error('Error generating dashboard metrics:', error);
      throw error;
    }
  }

  /**
   * Generate executive summary report
   */
  async generateExecutiveReport(
    tenant: string,
    reportPeriod: { start: Date; end: Date }
  ): Promise<IServiceLevelReport> {
    try {
      const reportId = this.generateReportId();
      
      // Calculate overall health score
      const healthScore = await this.calculateOverallHealth(tenant, reportPeriod);
      const overallHealth = this.getHealthRating(healthScore);

      // Get key metrics
      const keyMetrics = await this.getExecutiveKeyMetrics(tenant, reportPeriod);

      // Identify critical issues
      const criticalIssues = await this.identifyCriticalIssues(tenant, reportPeriod);

      // Generate recommendations
      const recommendations = await this.generateExecutiveRecommendations(tenant, reportPeriod);

      // Get SLA performance summary
      const slaPerformance = await this.getSLAPerformanceSummary(tenant, reportPeriod);

      // Get incident analysis
      const incidentAnalysis = await this.getIncidentAnalysis(tenant, reportPeriod);

      // Get customer feedback summary
      const customerFeedback = await this.getCustomerFeedbackSummary(tenant, reportPeriod);

      // Calculate financial impact
      const financialImpact = await this.calculateFinancialImpact(tenant, reportPeriod);

      return {
        reportId,
        reportType: 'executive',
        generatedDate: new Date(),
        reportPeriod,
        sections: {
          executiveSummary: {
            overallHealth,
            keyMetrics,
            criticalIssues,
            recommendations
          },
          slaPerformance,
          incidentAnalysis,
          customerFeedback,
          financialImpact
        }
      };
    } catch (error) {
      console.error('Error generating executive report:', error);
      throw error;
    }
  }

  /**
   * Generate detailed operational report
   */
  async generateOperationalReport(
    tenant: string,
    serviceIds: string[],
    reportPeriod: { start: Date; end: Date }
  ): Promise<IServiceLevelReport> {
    try {
      const reportId = this.generateReportId();

      // Get detailed SLA performance for specific services
      const slaPerformance = await this.getDetailedSLAPerformance(serviceIds, reportPeriod);

      // Get comprehensive incident analysis
      const incidentAnalysis = await this.getDetailedIncidentAnalysis(serviceIds, reportPeriod);

      // Get customer feedback with drill-down
      const customerFeedback = await this.getDetailedCustomerFeedback(serviceIds, reportPeriod);

      return {
        reportId,
        reportType: 'operational',
        generatedDate: new Date(),
        reportPeriod,
        sections: {
          slaPerformance,
          incidentAnalysis,
          customerFeedback
        }
      };
    } catch (error) {
      console.error('Error generating operational report:', error);
      throw error;
    }
  }

  /**
   * Export report data in various formats
   */
  async exportReport(
    reportId: string,
    format: 'pdf' | 'excel' | 'json' | 'csv'
  ): Promise<{
    filePath: string;
    fileName: string;
    mimeType: string;
  }> {
    try {
      // Get report data
      const report = await this.knex('service_reports')
        .where('report_id', reportId)
        .first();

      if (!report) {
        throw new Error('Report not found');
      }

      const fileName = `${report.report_name}_${report.generated_date.toISOString().split('T')[0]}.${format}`;
      const filePath = `/reports/${fileName}`;

      switch (format) {
        case 'pdf':
          await this.generatePDFReport(report, filePath);
          return {
            filePath,
            fileName,
            mimeType: 'application/pdf'
          };

        case 'excel':
          await this.generateExcelReport(report, filePath);
          return {
            filePath,
            fileName,
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          };

        case 'json':
          await this.generateJSONReport(report, filePath);
          return {
            filePath,
            fileName,
            mimeType: 'application/json'
          };

        case 'csv':
          await this.generateCSVReport(report, filePath);
          return {
            filePath,
            fileName,
            mimeType: 'text/csv'
          };

        default:
          throw new Error('Unsupported export format');
      }
    } catch (error) {
      console.error('Error exporting report:', error);
      throw error;
    }
  }

  /**
   * Schedule recurring reports
   */
  async scheduleRecurringReport(
    reportConfig: {
      tenant: string;
      reportType: 'executive' | 'operational' | 'tactical';
      name: string;
      frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly';
      services?: string[];
      recipients: string[];
      format: 'pdf' | 'excel';
      deliveryMethod: 'email' | 'portal' | 'both';
    }
  ): Promise<string> {
    try {
      const [schedule] = await this.knex('report_schedules').insert({
        schedule_id: this.knex.raw('uuid_generate_v4()'),
        tenant: reportConfig.tenant,
        report_type: reportConfig.reportType,
        report_name: reportConfig.name,
        frequency: reportConfig.frequency,
        service_ids: JSON.stringify(reportConfig.services || []),
        recipients: JSON.stringify(reportConfig.recipients),
        export_format: reportConfig.format,
        delivery_method: reportConfig.deliveryMethod,
        active: true,
        created_date: new Date()
      }).returning('schedule_id');

      // Calculate next run date
      const nextRun = this.calculateNextRunDate(reportConfig.frequency);
      
      await this.knex('report_schedules')
        .where('schedule_id', schedule.schedule_id)
        .update({ next_run_date: nextRun });

      return schedule.schedule_id;
    } catch (error) {
      console.error('Error scheduling recurring report:', error);
      throw error;
    }
  }

  /**
   * Get service performance scorecards
   */
  async getServiceScorecards(
    tenant: string,
    timeframe: { start: Date; end: Date }
  ): Promise<Array<{
    serviceId: string;
    serviceName: string;
    scorecard: {
      overallScore: number; // 0-100
      availability: {
        score: number;
        actual: number;
        target: number;
        trend: 'up' | 'down' | 'stable';
      };
      performance: {
        score: number;
        responseTime: number;
        resolutionTime: number;
        trend: 'up' | 'down' | 'stable';
      };
      quality: {
        score: number;
        incidentCount: number;
        customerSatisfaction: number;
        trend: 'up' | 'down' | 'stable';
      };
      compliance: {
        score: number;
        slaBreaches: number;
        complianceRate: number;
        trend: 'up' | 'down' | 'stable';
      };
    };
  }>> {
    try {
      const services = await this.knex('services')
        .where('tenant', tenant)
        .where('status', 'live')
        .select('*');

      const scorecards: Array<{
        serviceId: string;
        serviceName: string;
        scorecard: any;
      }> = [];

      for (const service of services) {
        const scorecard = await this.calculateServiceScorecard(service.service_id, timeframe);
        
        scorecards.push({
          serviceId: service.service_id,
          serviceName: service.service_name,
          scorecard
        });
      }

      return scorecards.sort((a, b) => b.scorecard.overallScore - a.scorecard.overallScore);
    } catch (error) {
      console.error('Error getting service scorecards:', error);
      throw error;
    }
  }

  /**
   * Generate SLA trend analysis
   */
  async generateSLATrendAnalysis(
    serviceIds: string[],
    metricType: 'availability' | 'responseTime' | 'resolutionTime' | 'satisfaction',
    period: number // days
  ): Promise<{
    trendData: Array<{
      date: string;
      serviceId: string;
      serviceName: string;
      value: number;
      target: number;
      variance: number;
    }>;
    insights: {
      overallTrend: 'improving' | 'declining' | 'stable';
      bestPerformers: string[];
      worstPerformers: string[];
      volatilityIndex: number;
      seasonalPatterns: any[];
    };
  }> {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - period);

      // Get trend data
      const trendData = await this.getTrendDataForServices(
        serviceIds,
        metricType,
        startDate,
        endDate
      );

      // Analyze trends and generate insights
      const insights = this.analyzeTrends(trendData, metricType);

      return { trendData, insights };
    } catch (error) {
      console.error('Error generating SLA trend analysis:', error);
      throw error;
    }
  }

  /**
   * Private helper methods
   */
  private async getOverviewMetrics(
    tenant: string,
    timeframe: { start: Date; end: Date }
  ): Promise<IDashboardMetrics['overview']> {
    // Get total services
    const totalServices = await this.knex('services')
      .where('tenant', tenant)
      .where('status', 'live')
      .count('* as count')
      .first();

    // Get active SLAs
    const activeSLAs = await this.knex('service_level_agreements')
      .where('tenant', tenant)
      .where('status', 'active')
      .count('* as count')
      .first();

    // Get performance metrics
    const performance = await this.knex('service_performance_records')
      .join('services', 'service_performance_records.service_id', 'services.service_id')
      .where('services.tenant', tenant)
      .whereBetween('measurement_date', [timeframe.start, timeframe.end])
      .avg('availability_percentage as avgAvailability')
      .avg('avg_response_time as avgResponseTime')
      .avg('csat_score as avgCSAT')
      .sum('total_incidents as totalIncidents')
      .first();

    // Calculate overall compliance
    const complianceData = await this.knex('service_performance_records')
      .join('services', 'service_performance_records.service_id', 'services.service_id')
      .where('services.tenant', tenant)
      .whereBetween('measurement_date', [timeframe.start, timeframe.end])
      .avg('sla_compliance_percentage as avgCompliance')
      .first();

    return {
      totalServices: parseInt(totalServices?.count as string) || 0,
      activeSLAs: parseInt(activeSLAs?.count as string) || 0,
      overallCompliance: parseFloat(complianceData?.avgCompliance as string) || 0,
      avgAvailability: parseFloat(performance?.avgAvailability as string) || 0,
      avgResponseTime: parseFloat(performance?.avgResponseTime as string) || 0,
      totalIncidents: parseInt(performance?.totalIncidents as string) || 0,
      avgCSAT: parseFloat(performance?.avgCSAT as string) || 0
    };
  }

  private async getComplianceDistribution(
    tenant: string,
    timeframe: { start: Date; end: Date }
  ): Promise<IDashboardMetrics['compliance']> {
    const compliance = await this.knex('service_performance_records')
      .join('services', 'service_performance_records.service_id', 'services.service_id')
      .where('services.tenant', tenant)
      .whereBetween('measurement_date', [timeframe.start, timeframe.end])
      .select(
        this.knex.raw(`
          SUM(CASE WHEN sla_compliance_percentage >= 98 THEN 1 ELSE 0 END) as compliant,
          SUM(CASE WHEN sla_compliance_percentage >= 95 AND sla_compliance_percentage < 98 THEN 1 ELSE 0 END) as warning,
          SUM(CASE WHEN sla_compliance_percentage >= 85 AND sla_compliance_percentage < 95 THEN 1 ELSE 0 END) as breach,
          SUM(CASE WHEN sla_compliance_percentage < 85 THEN 1 ELSE 0 END) as critical
        `)
      )
      .first();

    return {
      compliant: parseInt(compliance?.compliant as string) || 0,
      warning: parseInt(compliance?.warning as string) || 0,
      breach: parseInt(compliance?.breach as string) || 0,
      critical: parseInt(compliance?.critical as string) || 0
    };
  }

  private async getTrendData(
    tenant: string,
    timeframe: { start: Date; end: Date }
  ): Promise<IDashboardMetrics['trends']> {
    const trendData = await this.knex('service_performance_records')
      .join('services', 'service_performance_records.service_id', 'services.service_id')
      .where('services.tenant', tenant)
      .whereBetween('measurement_date', [timeframe.start, timeframe.end])
      .select(
        this.knex.raw('DATE(measurement_date) as date'),
        this.knex.raw('AVG(availability_percentage) as availability'),
        this.knex.raw('AVG(avg_response_time) as responseTime'),
        this.knex.raw('SUM(total_incidents) as incidents'),
        this.knex.raw('AVG(csat_score) as satisfaction')
      )
      .groupBy(this.knex.raw('DATE(measurement_date)'))
      .orderBy('date');

    return {
      availability: trendData.map(d => ({ date: d.date, value: parseFloat(d.availability) || 0 })),
      responseTime: trendData.map(d => ({ date: d.date, value: parseFloat(d.responseTime) || 0 })),
      incidents: trendData.map(d => ({ date: d.date, value: parseInt(d.incidents) || 0 })),
      satisfaction: trendData.map(d => ({ date: d.date, value: parseFloat(d.satisfaction) || 0 }))
    };
  }

  private async getTopIssues(
    tenant: string,
    timeframe: { start: Date; end: Date }
  ): Promise<IDashboardMetrics['topIssues']> {
    // This would typically query incident/problem data
    // For now, return mock data
    return [
      { service: 'Email Service', issue: 'High response time', count: 15, impact: 'high' },
      { service: 'Database', issue: 'Connection timeouts', count: 12, impact: 'medium' },
      { service: 'Authentication', issue: 'Login failures', count: 8, impact: 'high' }
    ];
  }

  private async calculateOverallHealth(
    tenant: string,
    period: { start: Date; end: Date }
  ): Promise<number> {
    const metrics = await this.getOverviewMetrics(tenant, period);
    
    // Weighted health score calculation
    const availabilityScore = (metrics.avgAvailability / 100) * 0.3;
    const complianceScore = (metrics.overallCompliance / 100) * 0.3;
    const csatScore = (metrics.avgCSAT / 5) * 0.2;
    const responseTimeScore = Math.max(0, (1 - metrics.avgResponseTime / 60)) * 0.2; // Normalize to 1 hour
    
    return Math.round((availabilityScore + complianceScore + csatScore + responseTimeScore) * 100);
  }

  private getHealthRating(score: number): 'excellent' | 'good' | 'fair' | 'poor' {
    if (score >= 90) return 'excellent';
    if (score >= 80) return 'good';
    if (score >= 70) return 'fair';
    return 'poor';
  }

  private async getExecutiveKeyMetrics(
    tenant: string,
    period: { start: Date; end: Date }
  ): Promise<any> {
    const overview = await this.getOverviewMetrics(tenant, period);
    return {
      serviceAvailability: `${overview.avgAvailability.toFixed(1)}%`,
      responseTime: `${overview.avgResponseTime.toFixed(1)} min`,
      customerSatisfaction: `${overview.avgCSAT.toFixed(1)}/5.0`,
      slaCompliance: `${overview.overallCompliance.toFixed(1)}%`,
      totalIncidents: overview.totalIncidents
    };
  }

  private async identifyCriticalIssues(
    tenant: string,
    period: { start: Date; end: Date }
  ): Promise<string[]> {
    const issues: string[] = [];
    
    const metrics = await this.getOverviewMetrics(tenant, period);
    
    if (metrics.overallCompliance < 95) {
      issues.push(`SLA compliance at ${metrics.overallCompliance.toFixed(1)}% - below target`);
    }
    
    if (metrics.avgAvailability < 99) {
      issues.push(`Service availability at ${metrics.avgAvailability.toFixed(1)}% - improvement needed`);
    }
    
    if (metrics.avgCSAT < 4.0) {
      issues.push(`Customer satisfaction at ${metrics.avgCSAT.toFixed(1)}/5.0 - customer experience concerns`);
    }
    
    return issues;
  }

  private async generateExecutiveRecommendations(
    tenant: string,
    period: { start: Date; end: Date }
  ): Promise<string[]> {
    const recommendations: string[] = [];
    const metrics = await this.getOverviewMetrics(tenant, period);
    
    if (metrics.overallCompliance < 98) {
      recommendations.push('Implement proactive monitoring to prevent SLA breaches');
    }
    
    if (metrics.avgResponseTime > 30) {
      recommendations.push('Review and optimize incident response processes');
    }
    
    if (metrics.avgCSAT < 4.5) {
      recommendations.push('Enhance customer communication and feedback mechanisms');
    }
    
    return recommendations;
  }

  private async getSLAPerformanceSummary(
    tenant: string,
    period: { start: Date; end: Date }
  ): Promise<any> {
    // Implementation would get detailed SLA performance for each service
    return { services: [] }; // Placeholder
  }

  private async getIncidentAnalysis(
    tenant: string,
    period: { start: Date; end: Date }
  ): Promise<any> {
    // Implementation would analyze incident data
    return {}; // Placeholder
  }

  private async getCustomerFeedbackSummary(
    tenant: string,
    period: { start: Date; end: Date }
  ): Promise<any> {
    // Implementation would summarize customer feedback
    return {}; // Placeholder
  }

  private async calculateFinancialImpact(
    tenant: string,
    period: { start: Date; end: Date }
  ): Promise<any> {
    // Implementation would calculate financial metrics
    return {}; // Placeholder
  }

  private async getDetailedSLAPerformance(
    serviceIds: string[],
    period: { start: Date; end: Date }
  ): Promise<any> {
    // Implementation would get detailed performance data
    return { services: [] }; // Placeholder
  }

  private async getDetailedIncidentAnalysis(
    serviceIds: string[],
    period: { start: Date; end: Date }
  ): Promise<any> {
    // Implementation would get detailed incident analysis
    return {}; // Placeholder
  }

  private async getDetailedCustomerFeedback(
    serviceIds: string[],
    period: { start: Date; end: Date }
  ): Promise<any> {
    // Implementation would get detailed customer feedback
    return {}; // Placeholder
  }

  private async calculateServiceScorecard(
    serviceId: string,
    timeframe: { start: Date; end: Date }
  ): Promise<any> {
    // Implementation would calculate comprehensive scorecard
    return {
      overallScore: 85,
      availability: { score: 90, actual: 99.2, target: 99.5, trend: 'stable' },
      performance: { score: 80, responseTime: 25, resolutionTime: 120, trend: 'up' },
      quality: { score: 85, incidentCount: 5, customerSatisfaction: 4.2, trend: 'stable' },
      compliance: { score: 88, slaBreaches: 2, complianceRate: 94.5, trend: 'down' }
    };
  }

  private async getTrendDataForServices(
    serviceIds: string[],
    metricType: string,
    startDate: Date,
    endDate: Date
  ): Promise<any[]> {
    // Implementation would get trend data
    return []; // Placeholder
  }

  private analyzeTrends(trendData: any[], metricType: string): any {
    // Implementation would analyze trends
    return {
      overallTrend: 'stable',
      bestPerformers: [],
      worstPerformers: [],
      volatilityIndex: 0,
      seasonalPatterns: []
    };
  }

  private calculateNextRunDate(frequency: string): Date {
    const now = new Date();
    
    switch (frequency) {
      case 'daily':
        now.setDate(now.getDate() + 1);
        break;
      case 'weekly':
        now.setDate(now.getDate() + 7);
        break;
      case 'monthly':
        now.setMonth(now.getMonth() + 1);
        break;
      case 'quarterly':
        now.setMonth(now.getMonth() + 3);
        break;
    }
    
    return now;
  }

  private generateReportId(): string {
    return `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Export format methods (would integrate with actual reporting libraries)
  private async generatePDFReport(report: any, filePath: string): Promise<void> {
    console.log(`Generating PDF report: ${filePath}`);
  }

  private async generateExcelReport(report: any, filePath: string): Promise<void> {
    console.log(`Generating Excel report: ${filePath}`);
  }

  private async generateJSONReport(report: any, filePath: string): Promise<void> {
    console.log(`Generating JSON report: ${filePath}`);
  }

  private async generateCSVReport(report: any, filePath: string): Promise<void> {
    console.log(`Generating CSV report: ${filePath}`);
  }
}

export default SLAReportingService;