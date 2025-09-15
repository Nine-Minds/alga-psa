import { Knex } from 'knex';

export interface IServiceKPI {
  kpi_id: string;
  tenant: string;
  service_id?: string; // null for tenant-wide KPIs
  kpi_name: string;
  kpi_category: 'availability' | 'performance' | 'quality' | 'efficiency' | 'customer' | 'financial';
  description: string;
  
  // Calculation Details
  calculation_method: 'simple_average' | 'weighted_average' | 'sum' | 'count' | 'percentage' | 'custom_formula';
  data_sources: string[]; // Array of table/field references
  calculation_formula?: string; // Custom formula if needed
  
  // Target and Thresholds
  target_value: number;
  target_unit: string;
  warning_threshold: number;
  critical_threshold: number;
  
  // Time Configuration
  measurement_frequency: 'hourly' | 'daily' | 'weekly' | 'monthly';
  reporting_period: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annually';
  
  // Status and Metadata
  status: 'active' | 'paused' | 'archived';
  owner: string; // User responsible for this KPI
  created_date: Date;
  updated_date?: Date;
}

export interface IKPIResult {
  result_id: string;
  kpi_id: string;
  measurement_date: Date;
  measurement_period_start: Date;
  measurement_period_end: Date;
  
  // Results
  actual_value: number;
  target_value: number;
  variance: number;
  variance_percentage: number;
  
  // Status
  status: 'excellent' | 'good' | 'warning' | 'critical';
  trend: 'improving' | 'declining' | 'stable';
  
  // Context
  data_points_count: number;
  confidence_level: number; // 0-100%
  notes?: string;
}

export interface IDashboardKPI {
  category: string;
  kpis: Array<{
    name: string;
    value: number;
    target: number;
    unit: string;
    status: 'excellent' | 'good' | 'warning' | 'critical';
    trend: 'improving' | 'declining' | 'stable';
    change: number; // Percentage change from previous period
  }>;
}

export interface IBenchmarkData {
  kpi_name: string;
  industry_average: number;
  industry_top_quartile: number;
  industry_bottom_quartile: number;
  peer_average?: number;
  organization_value: number;
  percentile_rank: number; // 0-100
}

export class ServiceMetricsService {
  constructor(private knex: Knex) {}

  /**
   * Create a new KPI definition
   */
  async createKPI(kpiData: Omit<IServiceKPI, 'kpi_id' | 'created_date'>): Promise<string> {
    try {
      const [kpi] = await this.knex('service_kpis').insert({
        kpi_id: this.knex.raw('uuid_generate_v4()'),
        ...kpiData,
        created_date: new Date()
      }).returning('kpi_id');

      // Create initial calculation schedule
      await this.scheduleKPICalculation(kpi.kpi_id, kpiData.measurement_frequency);

      return kpi.kpi_id;
    } catch (error) {
      console.error('Error creating KPI:', error);
      throw error;
    }
  }

  /**
   * Calculate KPI values for a specific period
   */
  async calculateKPI(
    kpiId: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<IKPIResult> {
    try {
      const kpi = await this.knex('service_kpis')
        .where('kpi_id', kpiId)
        .first();

      if (!kpi) {
        throw new Error('KPI not found');
      }

      // Calculate the actual value based on KPI configuration
      const actualValue = await this.calculateKPIValue(kpi, periodStart, periodEnd);
      
      // Calculate variance
      const variance = actualValue - kpi.target_value;
      const variancePercentage = kpi.target_value > 0 
        ? (variance / kpi.target_value) * 100 
        : 0;

      // Determine status
      const status = this.determineKPIStatus(actualValue, kpi);

      // Calculate trend
      const trend = await this.calculateKPITrend(kpiId, periodStart);

      // Get data points count for confidence level
      const dataPointsCount = await this.getDataPointsCount(kpi, periodStart, periodEnd);
      const confidenceLevel = this.calculateConfidenceLevel(dataPointsCount, kpi.measurement_frequency);

      const result: IKPIResult = {
        result_id: this.generateId(),
        kpi_id: kpiId,
        measurement_date: new Date(),
        measurement_period_start: periodStart,
        measurement_period_end: periodEnd,
        actual_value: actualValue,
        target_value: kpi.target_value,
        variance,
        variance_percentage: variancePercentage,
        status,
        trend,
        data_points_count: dataPointsCount,
        confidence_level: confidenceLevel
      };

      // Store the result
      await this.knex('kpi_results').insert(result);

      return result;
    } catch (error) {
      console.error('Error calculating KPI:', error);
      throw error;
    }
  }

  /**
   * Get dashboard KPIs grouped by category
   */
  async getDashboardKPIs(
    tenant: string,
    serviceId?: string
  ): Promise<IDashboardKPI[]> {
    try {
      let query = this.knex('service_kpis')
        .where('tenant', tenant)
        .where('status', 'active');

      if (serviceId) {
        query = query.where(function() {
          this.where('service_id', serviceId)
            .orWhereNull('service_id'); // Include tenant-wide KPIs
        });
      } else {
        query = query.whereNull('service_id'); // Only tenant-wide KPIs
      }

      const kpis = await query.select('*');

      // Group by category
      const groupedKPIs: { [category: string]: any[] } = {};
      
      for (const kpi of kpis) {
        if (!groupedKPIs[kpi.kpi_category]) {
          groupedKPIs[kpi.kpi_category] = [];
        }

        // Get latest result for this KPI
        const latestResult = await this.getLatestKPIResult(kpi.kpi_id);
        const previousResult = await this.getPreviousKPIResult(kpi.kpi_id);

        const change = latestResult && previousResult
          ? ((latestResult.actual_value - previousResult.actual_value) / previousResult.actual_value) * 100
          : 0;

        groupedKPIs[kpi.kpi_category].push({
          name: kpi.kpi_name,
          value: latestResult?.actual_value || 0,
          target: kpi.target_value,
          unit: kpi.target_unit,
          status: latestResult?.status || 'warning',
          trend: latestResult?.trend || 'stable',
          change
        });
      }

      // Convert to array format
      return Object.entries(groupedKPIs).map(([category, kpiList]) => ({
        category,
        kpis: kpiList
      }));
    } catch (error) {
      console.error('Error getting dashboard KPIs:', error);
      throw error;
    }
  }

  /**
   * Get detailed KPI performance over time
   */
  async getKPIPerformanceHistory(
    kpiId: string,
    periodDays: number = 30
  ): Promise<Array<{
    date: string;
    actual: number;
    target: number;
    status: string;
    variance: number;
  }>> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - periodDays);

      const results = await this.knex('kpi_results')
        .where('kpi_id', kpiId)
        .where('measurement_date', '>=', startDate)
        .orderBy('measurement_date', 'asc')
        .select('*');

      return results.map(result => ({
        date: result.measurement_date.toISOString().split('T')[0],
        actual: result.actual_value,
        target: result.target_value,
        status: result.status,
        variance: result.variance_percentage
      }));
    } catch (error) {
      console.error('Error getting KPI performance history:', error);
      throw error;
    }
  }

  /**
   * Generate comprehensive performance scorecard
   */
  async generatePerformanceScorecard(
    tenant: string,
    serviceId?: string,
    period: { start: Date; end: Date } = this.getDefaultPeriod()
  ): Promise<{
    overallScore: number;
    categories: {
      [category: string]: {
        score: number;
        kpis: Array<{
          name: string;
          score: number;
          actual: number;
          target: number;
          weight: number;
        }>;
      };
    };
    trends: {
      improving: number;
      stable: number;
      declining: number;
    };
    recommendations: string[];
  }> {
    try {
      const kpis = await this.getKPIsForScorecard(tenant, serviceId);
      const categories: any = {};
      let totalWeightedScore = 0;
      let totalWeight = 0;
      
      const trends = { improving: 0, stable: 0, declining: 0 };

      for (const kpi of kpis) {
        const result = await this.calculateKPI(kpi.kpi_id, period.start, period.end);
        const score = this.calculateKPIScore(result, kpi);
        const weight = this.getKPIWeight(kpi.kpi_category);

        if (!categories[kpi.kpi_category]) {
          categories[kpi.kpi_category] = {
            score: 0,
            kpis: [],
            totalWeight: 0
          };
        }

        categories[kpi.kpi_category].kpis.push({
          name: kpi.kpi_name,
          score,
          actual: result.actual_value,
          target: kpi.target_value,
          weight
        });

        categories[kpi.kpi_category].totalWeight += weight;
        totalWeightedScore += score * weight;
        totalWeight += weight;

        // Count trends
        trends[result.trend]++;
      }

      // Calculate category scores
      for (const category of Object.keys(categories)) {
        const categoryData = categories[category];
        const categoryWeightedScore = categoryData.kpis.reduce(
          (sum: number, kpi: any) => sum + (kpi.score * kpi.weight), 0
        );
        categoryData.score = categoryWeightedScore / categoryData.totalWeight;
      }

      const overallScore = totalWeight > 0 ? totalWeightedScore / totalWeight : 0;
      const recommendations = this.generateScoreCardRecommendations(categories, overallScore);

      return {
        overallScore: Math.round(overallScore),
        categories,
        trends,
        recommendations
      };
    } catch (error) {
      console.error('Error generating performance scorecard:', error);
      throw error;
    }
  }

  /**
   * Compare performance against industry benchmarks
   */
  async getBenchmarkComparison(
    tenant: string,
    serviceId?: string
  ): Promise<IBenchmarkData[]> {
    try {
      const kpis = await this.getKPIsForBenchmarking(tenant, serviceId);
      const benchmarks: IBenchmarkData[] = [];

      for (const kpi of kpis) {
        const latestResult = await this.getLatestKPIResult(kpi.kpi_id);
        const industryData = await this.getIndustryBenchmarks(kpi.kpi_name);

        if (latestResult && industryData) {
          const percentileRank = this.calculatePercentileRank(
            latestResult.actual_value,
            industryData
          );

          benchmarks.push({
            kpi_name: kpi.kpi_name,
            industry_average: industryData.average,
            industry_top_quartile: industryData.top_quartile,
            industry_bottom_quartile: industryData.bottom_quartile,
            organization_value: latestResult.actual_value,
            percentile_rank: percentileRank
          });
        }
      }

      return benchmarks.sort((a, b) => b.percentile_rank - a.percentile_rank);
    } catch (error) {
      console.error('Error getting benchmark comparison:', error);
      throw error;
    }
  }

  /**
   * Set up automated KPI alerts
   */
  async configureKPIAlerts(
    kpiId: string,
    alertConfig: {
      enableWarningAlerts: boolean;
      enableCriticalAlerts: boolean;
      enableTrendAlerts: boolean;
      recipients: string[];
      notificationChannels: ('email' | 'sms' | 'webhook')[];
      customThresholds?: {
        warning?: number;
        critical?: number;
      };
    }
  ): Promise<void> {
    try {
      await this.knex('kpi_alert_configurations').insert({
        config_id: this.knex.raw('uuid_generate_v4()'),
        kpi_id: kpiId,
        enable_warning_alerts: alertConfig.enableWarningAlerts,
        enable_critical_alerts: alertConfig.enableCriticalAlerts,
        enable_trend_alerts: alertConfig.enableTrendAlerts,
        recipients: JSON.stringify(alertConfig.recipients),
        notification_channels: JSON.stringify(alertConfig.notificationChannels),
        custom_thresholds: JSON.stringify(alertConfig.customThresholds || {}),
        created_date: new Date()
      }).onConflict('kpi_id').merge();
    } catch (error) {
      console.error('Error configuring KPI alerts:', error);
      throw error;
    }
  }

  /**
   * Process KPI alerts based on current values
   */
  async processKPIAlerts(kpiResults: IKPIResult[]): Promise<void> {
    try {
      for (const result of kpiResults) {
        const alertConfig = await this.knex('kpi_alert_configurations')
          .where('kpi_id', result.kpi_id)
          .first();

        if (!alertConfig) continue;

        const shouldAlert = this.shouldTriggerAlert(result, alertConfig);
        
        if (shouldAlert) {
          await this.sendKPIAlert(result, alertConfig);
        }
      }
    } catch (error) {
      console.error('Error processing KPI alerts:', error);
    }
  }

  /**
   * Get predefined ITIL KPI templates
   */
  getITILKPITemplates(): Array<Omit<IServiceKPI, 'kpi_id' | 'tenant' | 'service_id' | 'owner' | 'created_date'>> {
    return [
      // Availability KPIs
      {
        kpi_name: 'Service Availability',
        kpi_category: 'availability',
        description: 'Percentage of time service is available to users',
        calculation_method: 'percentage',
        data_sources: ['service_performance_records.uptime_minutes', 'service_performance_records.downtime_minutes'],
        target_value: 99.5,
        target_unit: '%',
        warning_threshold: 99.0,
        critical_threshold: 98.0,
        measurement_frequency: 'daily',
        reporting_period: 'monthly',
        status: 'active'
      },
      {
        kpi_name: 'Mean Time Between Failures (MTBF)',
        kpi_category: 'availability',
        description: 'Average time between service failures',
        calculation_method: 'custom_formula',
        data_sources: ['service_performance_records.uptime_minutes', 'service_performance_records.total_incidents'],
        calculation_formula: 'total_uptime / number_of_failures',
        target_value: 720, // 30 days in hours
        target_unit: 'hours',
        warning_threshold: 480,
        critical_threshold: 240,
        measurement_frequency: 'weekly',
        reporting_period: 'monthly',
        status: 'active'
      },

      // Performance KPIs
      {
        kpi_name: 'Average Response Time',
        kpi_category: 'performance',
        description: 'Average time to respond to service requests',
        calculation_method: 'simple_average',
        data_sources: ['service_performance_records.avg_response_time'],
        target_value: 15,
        target_unit: 'minutes',
        warning_threshold: 20,
        critical_threshold: 30,
        measurement_frequency: 'daily',
        reporting_period: 'weekly',
        status: 'active'
      },
      {
        kpi_name: 'Mean Time to Resolve (MTTR)',
        kpi_category: 'performance',
        description: 'Average time to resolve incidents',
        calculation_method: 'weighted_average',
        data_sources: ['service_performance_records.resolution_times'],
        target_value: 4,
        target_unit: 'hours',
        warning_threshold: 6,
        critical_threshold: 8,
        measurement_frequency: 'daily',
        reporting_period: 'weekly',
        status: 'active'
      },

      // Quality KPIs
      {
        kpi_name: 'First Call Resolution Rate',
        kpi_category: 'quality',
        description: 'Percentage of incidents resolved on first contact',
        calculation_method: 'percentage',
        data_sources: ['tickets.escalated', 'tickets.closed_at'],
        target_value: 75,
        target_unit: '%',
        warning_threshold: 70,
        critical_threshold: 60,
        measurement_frequency: 'weekly',
        reporting_period: 'monthly',
        status: 'active'
      },
      {
        kpi_name: 'Incident Recurrence Rate',
        kpi_category: 'quality',
        description: 'Percentage of incidents that recur within 30 days',
        calculation_method: 'percentage',
        data_sources: ['tickets.related_problem_id', 'tickets.closed_at'],
        target_value: 5,
        target_unit: '%',
        warning_threshold: 8,
        critical_threshold: 12,
        measurement_frequency: 'weekly',
        reporting_period: 'monthly',
        status: 'active'
      },

      // Customer KPIs
      {
        kpi_name: 'Customer Satisfaction Score (CSAT)',
        kpi_category: 'customer',
        description: 'Average customer satisfaction rating',
        calculation_method: 'simple_average',
        data_sources: ['customer_satisfaction_responses.csat_score'],
        target_value: 4.5,
        target_unit: '/5.0',
        warning_threshold: 4.0,
        critical_threshold: 3.5,
        measurement_frequency: 'weekly',
        reporting_period: 'monthly',
        status: 'active'
      },
      {
        kpi_name: 'Net Promoter Score (NPS)',
        kpi_category: 'customer',
        description: 'Customer loyalty and advocacy score',
        calculation_method: 'custom_formula',
        data_sources: ['customer_satisfaction_responses.nps_score'],
        calculation_formula: '((promoters - detractors) / total_responses) * 100',
        target_value: 50,
        target_unit: 'points',
        warning_threshold: 30,
        critical_threshold: 0,
        measurement_frequency: 'monthly',
        reporting_period: 'quarterly',
        status: 'active'
      },

      // Efficiency KPIs
      {
        kpi_name: 'Change Success Rate',
        kpi_category: 'efficiency',
        description: 'Percentage of changes implemented successfully',
        calculation_method: 'percentage',
        data_sources: ['change_requests.status', 'change_requests.implementation_status'],
        target_value: 95,
        target_unit: '%',
        warning_threshold: 90,
        critical_threshold: 85,
        measurement_frequency: 'weekly',
        reporting_period: 'monthly',
        status: 'active'
      },
      {
        kpi_name: 'Knowledge Base Usage',
        kpi_category: 'efficiency',
        description: 'Percentage of incidents resolved using knowledge base',
        calculation_method: 'percentage',
        data_sources: ['tickets.resolution_code', 'known_errors.known_error_id'],
        target_value: 40,
        target_unit: '%',
        warning_threshold: 30,
        critical_threshold: 20,
        measurement_frequency: 'weekly',
        reporting_period: 'monthly',
        status: 'active'
      },

      // Financial KPIs
      {
        kpi_name: 'Cost per Incident',
        kpi_category: 'financial',
        description: 'Average cost to resolve an incident',
        calculation_method: 'custom_formula',
        data_sources: ['service_performance_records.total_incidents', 'services.annual_cost'],
        calculation_formula: 'total_service_cost / total_incidents',
        target_value: 50,
        target_unit: '$',
        warning_threshold: 75,
        critical_threshold: 100,
        measurement_frequency: 'monthly',
        reporting_period: 'quarterly',
        status: 'active'
      }
    ];
  }

  /**
   * Private helper methods
   */
  private async calculateKPIValue(
    kpi: IServiceKPI,
    periodStart: Date,
    periodEnd: Date
  ): Promise<number> {
    switch (kpi.calculation_method) {
      case 'simple_average':
        return await this.calculateSimpleAverage(kpi, periodStart, periodEnd);
      case 'weighted_average':
        return await this.calculateWeightedAverage(kpi, periodStart, periodEnd);
      case 'percentage':
        return await this.calculatePercentage(kpi, periodStart, periodEnd);
      case 'sum':
        return await this.calculateSum(kpi, periodStart, periodEnd);
      case 'count':
        return await this.calculateCount(kpi, periodStart, periodEnd);
      case 'custom_formula':
        return await this.calculateCustomFormula(kpi, periodStart, periodEnd);
      default:
        throw new Error(`Unsupported calculation method: ${kpi.calculation_method}`);
    }
  }

  private async calculateSimpleAverage(
    kpi: IServiceKPI,
    periodStart: Date,
    periodEnd: Date
  ): Promise<number> {
    // Implementation would vary based on data source
    // For now, return a mock calculation
    return 85.5;
  }

  private async calculateWeightedAverage(
    kpi: IServiceKPI,
    periodStart: Date,
    periodEnd: Date
  ): Promise<number> {
    // Implementation for weighted average
    return 87.2;
  }

  private async calculatePercentage(
    kpi: IServiceKPI,
    periodStart: Date,
    periodEnd: Date
  ): Promise<number> {
    // Implementation for percentage calculation
    return 94.8;
  }

  private async calculateSum(
    kpi: IServiceKPI,
    periodStart: Date,
    periodEnd: Date
  ): Promise<number> {
    // Implementation for sum calculation
    return 1250;
  }

  private async calculateCount(
    kpi: IServiceKPI,
    periodStart: Date,
    periodEnd: Date
  ): Promise<number> {
    // Implementation for count calculation
    return 45;
  }

  private async calculateCustomFormula(
    kpi: IServiceKPI,
    periodStart: Date,
    periodEnd: Date
  ): Promise<number> {
    // Implementation for custom formula evaluation
    return 72.3;
  }

  private determineKPIStatus(actualValue: number, kpi: IServiceKPI): 'excellent' | 'good' | 'warning' | 'critical' {
    if (actualValue >= kpi.target_value) return 'excellent';
    if (actualValue >= kpi.warning_threshold) return 'good';
    if (actualValue >= kpi.critical_threshold) return 'warning';
    return 'critical';
  }

  private async calculateKPITrend(kpiId: string, periodStart: Date): Promise<'improving' | 'declining' | 'stable'> {
    const previousPeriodStart = new Date(periodStart);
    previousPeriodStart.setMonth(previousPeriodStart.getMonth() - 1);

    const currentResult = await this.getLatestKPIResult(kpiId);
    const previousResult = await this.knex('kpi_results')
      .where('kpi_id', kpiId)
      .where('measurement_period_start', '>=', previousPeriodStart)
      .where('measurement_period_start', '<', periodStart)
      .orderBy('measurement_date', 'desc')
      .first();

    if (!currentResult || !previousResult) return 'stable';

    const threshold = 2; // 2% threshold
    const change = ((currentResult.actual_value - previousResult.actual_value) / previousResult.actual_value) * 100;

    if (change > threshold) return 'improving';
    if (change < -threshold) return 'declining';
    return 'stable';
  }

  private async getDataPointsCount(kpi: IServiceKPI, periodStart: Date, periodEnd: Date): Promise<number> {
    // Mock implementation - would count actual data points used in calculation
    return 30;
  }

  private calculateConfidenceLevel(dataPoints: number, frequency: string): number {
    const minimumRequired = this.getMinimumDataPoints(frequency);
    return Math.min(100, (dataPoints / minimumRequired) * 100);
  }

  private getMinimumDataPoints(frequency: string): number {
    switch (frequency) {
      case 'hourly': return 24;
      case 'daily': return 7;
      case 'weekly': return 4;
      case 'monthly': return 3;
      default: return 1;
    }
  }

  private async scheduleKPICalculation(kpiId: string, frequency: string): Promise<void> {
    // Implementation would integrate with job scheduler
    console.log(`Scheduled KPI calculation for ${kpiId} with frequency: ${frequency}`);
  }

  private async getLatestKPIResult(kpiId: string): Promise<IKPIResult | null> {
    return await this.knex('kpi_results')
      .where('kpi_id', kpiId)
      .orderBy('measurement_date', 'desc')
      .first();
  }

  private async getPreviousKPIResult(kpiId: string): Promise<IKPIResult | null> {
    const results = await this.knex('kpi_results')
      .where('kpi_id', kpiId)
      .orderBy('measurement_date', 'desc')
      .limit(2);

    return results.length > 1 ? results[1] : null;
  }

  private async getKPIsForScorecard(tenant: string, serviceId?: string): Promise<IServiceKPI[]> {
    let query = this.knex('service_kpis')
      .where('tenant', tenant)
      .where('status', 'active');

    if (serviceId) {
      query = query.where(function() {
        this.where('service_id', serviceId).orWhereNull('service_id');
      });
    }

    return await query.select('*');
  }

  private calculateKPIScore(result: IKPIResult, kpi: IServiceKPI): number {
    // Score based on how close the actual value is to the target
    const ratio = result.actual_value / kpi.target_value;
    
    if (ratio >= 1) return 100; // Exceeds target
    if (ratio >= kpi.warning_threshold / kpi.target_value) return 80;
    if (ratio >= kpi.critical_threshold / kpi.target_value) return 60;
    return Math.max(0, ratio * 40); // Minimum score based on percentage of target achieved
  }

  private getKPIWeight(category: string): number {
    const weights = {
      availability: 25,
      performance: 20,
      quality: 20,
      customer: 15,
      efficiency: 10,
      financial: 10
    };
    return weights[category as keyof typeof weights] || 10;
  }

  private generateScoreCardRecommendations(categories: any, overallScore: number): string[] {
    const recommendations: string[] = [];

    if (overallScore < 70) {
      recommendations.push('Overall performance is below acceptable levels. Immediate action required.');
    }

    // Check each category
    for (const [category, data] of Object.entries(categories) as [string, any][]) {
      if (data.score < 70) {
        recommendations.push(`${category} performance needs improvement. Focus on underperforming KPIs.`);
      }
    }

    if (recommendations.length === 0) {
      recommendations.push('Performance is within acceptable ranges. Continue monitoring and maintain current standards.');
    }

    return recommendations;
  }

  private async getKPIsForBenchmarking(tenant: string, serviceId?: string): Promise<IServiceKPI[]> {
    // Get KPIs that have industry benchmarks available
    return await this.getKPIsForScorecard(tenant, serviceId);
  }

  private async getIndustryBenchmarks(kpiName: string): Promise<{
    average: number;
    top_quartile: number;
    bottom_quartile: number;
  } | null> {
    // Mock industry benchmarks - would come from external data source
    const benchmarks: { [key: string]: any } = {
      'Service Availability': { average: 99.0, top_quartile: 99.8, bottom_quartile: 97.5 },
      'Average Response Time': { average: 20, top_quartile: 10, bottom_quartile: 45 },
      'Customer Satisfaction Score (CSAT)': { average: 4.0, top_quartile: 4.7, bottom_quartile: 3.2 }
    };

    return benchmarks[kpiName] || null;
  }

  private calculatePercentileRank(value: number, industryData: any): number {
    // Simple percentile calculation
    if (value >= industryData.top_quartile) return 90;
    if (value >= industryData.average) return 70;
    if (value >= industryData.bottom_quartile) return 30;
    return 10;
  }

  private shouldTriggerAlert(result: IKPIResult, alertConfig: any): boolean {
    if (!alertConfig) return false;

    if (result.status === 'critical' && alertConfig.enable_critical_alerts) return true;
    if (result.status === 'warning' && alertConfig.enable_warning_alerts) return true;
    if (result.trend === 'declining' && alertConfig.enable_trend_alerts) return true;

    return false;
  }

  private async sendKPIAlert(result: IKPIResult, alertConfig: any): Promise<void> {
    const config = {
      recipients: JSON.parse(alertConfig.recipients),
      channels: JSON.parse(alertConfig.notification_channels)
    };

    console.log('KPI Alert:', {
      kpiId: result.kpi_id,
      status: result.status,
      value: result.actual_value,
      target: result.target_value,
      recipients: config.recipients
    });
  }

  private getDefaultPeriod(): { start: Date; end: Date } {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 1);
    return { start, end };
  }

  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export default ServiceMetricsService;