import { Knex } from 'knex';
import { IServiceLevelAgreement, IServiceLevelObjective, IServicePerformanceRecord } from '../../interfaces/service.interfaces';

export interface ISLAMetrics {
  availability: {
    current: number;
    target: number;
    trend: 'improving' | 'declining' | 'stable';
  };
  responseTime: {
    current: number;
    target: number;
    p95: number;
    p99: number;
  };
  resolutionTime: {
    byPriority: {
      [key: string]: {
        current: number;
        target: number;
        breaches: number;
      };
    };
  };
  compliance: {
    overall: number;
    byMetric: {
      availability: number;
      responseTime: number;
      resolutionTime: number;
    };
  };
}

export interface ISLABreach {
  breach_id: string;
  sla_id: string;
  service_id: string;
  breach_type: 'availability' | 'response_time' | 'resolution_time';
  severity: 'warning' | 'minor' | 'major' | 'critical';
  threshold_value: number;
  actual_value: number;
  breach_duration: number; // minutes
  breach_start: Date;
  breach_end?: Date;
  impact_description: string;
  resolved: boolean;
  root_cause?: string;
  corrective_actions?: string;
}

export class SLAMonitoringService {
  constructor(private knex: Knex) {}

  /**
   * Monitor all active SLAs and detect breaches
   */
  async monitorAllSLAs(tenant: string): Promise<{
    monitored: number;
    breaches: ISLABreach[];
    warnings: ISLABreach[];
  }> {
    try {
      // Get all active SLAs for the tenant
      const activeSLAs = await this.knex('service_level_agreements')
        .where('tenant', tenant)
        .where('status', 'active')
        .select('*');

      let totalBreaches: ISLABreach[] = [];
      let totalWarnings: ISLABreach[] = [];

      for (const sla of activeSLAs) {
        const slaResults = await this.monitorSLA(sla.sla_id);
        totalBreaches.push(...slaResults.breaches);
        totalWarnings.push(...slaResults.warnings);
      }

      return {
        monitored: activeSLAs.length,
        breaches: totalBreaches,
        warnings: totalWarnings
      };
    } catch (error) {
      console.error('Error monitoring all SLAs:', error);
      throw error;
    }
  }

  /**
   * Monitor specific SLA for breaches
   */
  async monitorSLA(slaId: string): Promise<{
    breaches: ISLABreach[];
    warnings: ISLABreach[];
    metrics: ISLAMetrics;
  }> {
    try {
      const sla = await this.knex('service_level_agreements')
        .where('sla_id', slaId)
        .first();

      if (!sla) {
        throw new Error('SLA not found');
      }

      // Get current performance metrics
      const metrics = await this.calculateSLAMetrics(slaId);
      
      // Detect breaches and warnings
      const breaches: ISLABreach[] = [];
      const warnings: ISLABreach[] = [];

      // Check availability breach
      if (metrics.availability.current < sla.availability_target) {
        const breach = await this.createBreachRecord({
          sla_id: slaId,
          service_id: sla.service_id,
          breach_type: 'availability',
          severity: this.calculateBreachSeverity(
            'availability',
            metrics.availability.current,
            sla.availability_target
          ),
          threshold_value: sla.availability_target,
          actual_value: metrics.availability.current,
          impact_description: `Service availability ${metrics.availability.current.toFixed(2)}% is below target ${sla.availability_target}%`
        });

        if (breach.severity === 'warning') {
          warnings.push(breach);
        } else {
          breaches.push(breach);
        }
      }

      // Check response time breaches
      if (metrics.responseTime.current > sla.response_time_target) {
        const breach = await this.createBreachRecord({
          sla_id: slaId,
          service_id: sla.service_id,
          breach_type: 'response_time',
          severity: this.calculateBreachSeverity(
            'response_time',
            metrics.responseTime.current,
            sla.response_time_target
          ),
          threshold_value: sla.response_time_target,
          actual_value: metrics.responseTime.current,
          impact_description: `Average response time ${metrics.responseTime.current.toFixed(1)} minutes exceeds target ${sla.response_time_target} minutes`
        });

        if (breach.severity === 'warning') {
          warnings.push(breach);
        } else {
          breaches.push(breach);
        }
      }

      // Check resolution time breaches by priority
      for (const [priority, resolutionData] of Object.entries(metrics.resolutionTime.byPriority)) {
        const targetKey = `priority_${priority}` as keyof typeof sla.resolution_time_targets;
        const target = sla.resolution_time_targets[targetKey];
        
        if (target && resolutionData.current > target) {
          const breach = await this.createBreachRecord({
            sla_id: slaId,
            service_id: sla.service_id,
            breach_type: 'resolution_time',
            severity: this.calculateBreachSeverity(
              'resolution_time',
              resolutionData.current,
              target
            ),
            threshold_value: target,
            actual_value: resolutionData.current,
            impact_description: `Priority ${priority} resolution time ${resolutionData.current.toFixed(1)} hours exceeds target ${target} hours`
          });

          if (breach.severity === 'warning') {
            warnings.push(breach);
          } else {
            breaches.push(breach);
          }
        }
      }

      // Store monitoring results
      await this.recordMonitoringResults(slaId, metrics, breaches, warnings);

      return { breaches, warnings, metrics };
    } catch (error) {
      console.error('Error monitoring SLA:', error);
      throw error;
    }
  }

  /**
   * Calculate comprehensive SLA metrics
   */
  async calculateSLAMetrics(slaId: string): Promise<ISLAMetrics> {
    try {
      const sla = await this.knex('service_level_agreements')
        .where('sla_id', slaId)
        .first();

      const serviceId = sla.service_id;
      const measurementPeriod = this.getMeasurementPeriod(sla.uptime_measurement_period);

      // Get performance records for the measurement period
      const performanceRecords = await this.knex('service_performance_records')
        .where('service_id', serviceId)
        .where('measurement_period_start', '>=', measurementPeriod.start)
        .where('measurement_period_end', '<=', measurementPeriod.end)
        .orderBy('measurement_date', 'desc');

      // Calculate availability metrics
      const availabilityMetrics = this.calculateAvailabilityMetrics(performanceRecords);

      // Calculate response time metrics
      const responseTimeMetrics = this.calculateResponseTimeMetrics(performanceRecords);

      // Calculate resolution time metrics
      const resolutionTimeMetrics = this.calculateResolutionTimeMetrics(performanceRecords);

      // Calculate compliance metrics
      const complianceMetrics = this.calculateComplianceMetrics(
        sla,
        availabilityMetrics,
        responseTimeMetrics,
        resolutionTimeMetrics
      );

      return {
        availability: {
          current: availabilityMetrics.current,
          target: sla.availability_target,
          trend: availabilityMetrics.trend
        },
        responseTime: {
          current: responseTimeMetrics.average,
          target: sla.response_time_target,
          p95: responseTimeMetrics.p95,
          p99: responseTimeMetrics.p99
        },
        resolutionTime: {
          byPriority: resolutionTimeMetrics
        },
        compliance: complianceMetrics
      };
    } catch (error) {
      console.error('Error calculating SLA metrics:', error);
      throw error;
    }
  }

  /**
   * Get SLA performance history for trending
   */
  async getSLAPerformanceHistory(
    slaId: string,
    periodDays: number = 30
  ): Promise<Array<{
    date: string;
    availability: number;
    responseTime: number;
    resolutionTime: number;
    compliance: number;
    incidents: number;
  }>> {
    try {
      const sla = await this.knex('service_level_agreements')
        .where('sla_id', slaId)
        .first();

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - periodDays);

      const history = await this.knex('service_performance_records')
        .where('service_id', sla.service_id)
        .where('measurement_date', '>=', startDate)
        .orderBy('measurement_date', 'asc')
        .select('*');

      return history.map(record => ({
        date: record.measurement_date.toISOString().split('T')[0],
        availability: record.availability_percentage || 0,
        responseTime: record.avg_response_time || 0,
        resolutionTime: this.calculateWeightedResolutionTime(record.resolution_times),
        compliance: record.sla_compliance_percentage || 0,
        incidents: record.total_incidents || 0
      }));
    } catch (error) {
      console.error('Error getting SLA performance history:', error);
      throw error;
    }
  }

  /**
   * Generate SLA compliance report
   */
  async generateSLAComplianceReport(
    tenantOrSlaIds: string | string[],
    reportPeriod: {
      start: Date;
      end: Date;
    }
  ): Promise<{
    summary: {
      totalSLAs: number;
      compliantSLAs: number;
      overallCompliance: number;
      totalBreaches: number;
    };
    slaDetails: Array<{
      slaId: string;
      slaName: string;
      serviceName: string;
      compliance: number;
      availability: {
        actual: number;
        target: number;
        compliant: boolean;
      };
      responseTime: {
        actual: number;
        target: number;
        compliant: boolean;
      };
      resolutionTime: {
        compliant: boolean;
        breaches: number;
      };
      breaches: ISLABreach[];
    }>;
  }> {
    try {
      let slaQuery = this.knex('service_level_agreements')
        .join('services', 'service_level_agreements.service_id', 'services.service_id')
        .where('service_level_agreements.status', 'active');

      if (typeof tenantOrSlaIds === 'string') {
        // It's a tenant ID
        slaQuery = slaQuery.where('service_level_agreements.tenant', tenantOrSlaIds);
      } else {
        // It's an array of SLA IDs
        slaQuery = slaQuery.whereIn('service_level_agreements.sla_id', tenantOrSlaIds);
      }

      const slas = await slaQuery.select(
        'service_level_agreements.*',
        'services.service_name'
      );

      const slaDetails = [];
      let totalBreaches = 0;
      let compliantCount = 0;

      for (const sla of slas) {
        const metrics = await this.calculateSLAMetrics(sla.sla_id);
        const breaches = await this.getSLABreaches(sla.sla_id, reportPeriod);

        const availabilityCompliant = metrics.availability.current >= sla.availability_target;
        const responseTimeCompliant = metrics.responseTime.current <= sla.response_time_target;
        const resolutionTimeCompliant = this.checkResolutionTimeCompliance(
          metrics.resolutionTime.byPriority,
          sla.resolution_time_targets
        );

        const isCompliant = availabilityCompliant && responseTimeCompliant && resolutionTimeCompliant.compliant;
        if (isCompliant) compliantCount++;

        totalBreaches += breaches.length;

        slaDetails.push({
          slaId: sla.sla_id,
          slaName: sla.sla_name,
          serviceName: sla.service_name,
          compliance: metrics.compliance.overall,
          availability: {
            actual: metrics.availability.current,
            target: sla.availability_target,
            compliant: availabilityCompliant
          },
          responseTime: {
            actual: metrics.responseTime.current,
            target: sla.response_time_target,
            compliant: responseTimeCompliant
          },
          resolutionTime: {
            compliant: resolutionTimeCompliant.compliant,
            breaches: resolutionTimeCompliant.breaches
          },
          breaches
        });
      }

      return {
        summary: {
          totalSLAs: slas.length,
          compliantSLAs: compliantCount,
          overallCompliance: slas.length > 0 ? (compliantCount / slas.length) * 100 : 0,
          totalBreaches
        },
        slaDetails
      };
    } catch (error) {
      console.error('Error generating SLA compliance report:', error);
      throw error;
    }
  }

  /**
   * Set up SLA alerts and notifications
   */
  async configureSLAAlerts(
    slaId: string,
    alertConfig: {
      enabledBreachTypes: ('availability' | 'response_time' | 'resolution_time')[];
      warningThresholds: {
        availability?: number; // Percentage below target to trigger warning
        responseTime?: number; // Percentage above target to trigger warning
        resolutionTime?: number;
      };
      notificationChannels: ('email' | 'sms' | 'webhook')[];
      recipients: string[]; // User IDs
      escalationLevels: {
        level: number;
        delayMinutes: number;
        recipients: string[];
      }[];
    }
  ): Promise<void> {
    try {
      await this.knex('sla_alert_configurations').insert({
        config_id: this.knex.raw('uuid_generate_v4()'),
        sla_id: slaId,
        enabled_breach_types: JSON.stringify(alertConfig.enabledBreachTypes),
        warning_thresholds: JSON.stringify(alertConfig.warningThresholds),
        notification_channels: JSON.stringify(alertConfig.notificationChannels),
        recipients: JSON.stringify(alertConfig.recipients),
        escalation_levels: JSON.stringify(alertConfig.escalationLevels),
        created_date: new Date()
      }).onConflict('sla_id').merge();
    } catch (error) {
      console.error('Error configuring SLA alerts:', error);
      throw error;
    }
  }

  /**
   * Process SLA alerts for breaches
   */
  async processSLAAlerts(breaches: ISLABreach[]): Promise<void> {
    try {
      for (const breach of breaches) {
        const alertConfig = await this.knex('sla_alert_configurations')
          .where('sla_id', breach.sla_id)
          .first();

        if (!alertConfig) continue;

        const config = {
          enabledBreachTypes: JSON.parse(alertConfig.enabled_breach_types),
          notificationChannels: JSON.parse(alertConfig.notification_channels),
          recipients: JSON.parse(alertConfig.recipients),
          escalationLevels: JSON.parse(alertConfig.escalation_levels)
        };

        if (config.enabledBreachTypes.includes(breach.breach_type)) {
          await this.sendSLAAlert(breach, config);
        }
      }
    } catch (error) {
      console.error('Error processing SLA alerts:', error);
    }
  }

  /**
   * Helper Methods
   */
  private calculateBreachSeverity(
    breachType: string,
    actualValue: number,
    targetValue: number
  ): 'warning' | 'minor' | 'major' | 'critical' {
    let deviationPercent: number;

    if (breachType === 'availability') {
      deviationPercent = ((targetValue - actualValue) / targetValue) * 100;
    } else {
      deviationPercent = ((actualValue - targetValue) / targetValue) * 100;
    }

    if (deviationPercent <= 5) return 'warning';
    if (deviationPercent <= 15) return 'minor';
    if (deviationPercent <= 30) return 'major';
    return 'critical';
  }

  private async createBreachRecord(breachData: Partial<ISLABreach>): Promise<ISLABreach> {
    const breach: ISLABreach = {
      breach_id: this.generateId(),
      sla_id: breachData.sla_id!,
      service_id: breachData.service_id!,
      breach_type: breachData.breach_type!,
      severity: breachData.severity!,
      threshold_value: breachData.threshold_value!,
      actual_value: breachData.actual_value!,
      breach_duration: 0, // Will be calculated when resolved
      breach_start: new Date(),
      impact_description: breachData.impact_description!,
      resolved: false
    };

    await this.knex('sla_breaches').insert({
      ...breach,
      created_date: new Date()
    });

    return breach;
  }

  private getMeasurementPeriod(period: string): { start: Date; end: Date } {
    const end = new Date();
    const start = new Date();

    switch (period) {
      case 'monthly':
        start.setMonth(start.getMonth() - 1);
        break;
      case 'quarterly':
        start.setMonth(start.getMonth() - 3);
        break;
      case 'annually':
        start.setFullYear(start.getFullYear() - 1);
        break;
      default:
        start.setMonth(start.getMonth() - 1);
    }

    return { start, end };
  }

  private calculateAvailabilityMetrics(records: any[]): {
    current: number;
    trend: 'improving' | 'declining' | 'stable';
  } {
    if (records.length === 0) return { current: 0, trend: 'stable' };

    const totalUptime = records.reduce((sum, record) => sum + (record.uptime_minutes || 0), 0);
    const totalTime = records.reduce((sum, record) => 
      sum + (record.uptime_minutes || 0) + (record.downtime_minutes || 0), 0);

    const current = totalTime > 0 ? (totalUptime / totalTime) * 100 : 0;

    // Calculate trend
    const half = Math.ceil(records.length / 2);
    const recent = records.slice(0, half);
    const older = records.slice(half);

    const recentAvg = recent.reduce((sum, r) => sum + (r.availability_percentage || 0), 0) / recent.length;
    const olderAvg = older.reduce((sum, r) => sum + (r.availability_percentage || 0), 0) / older.length;

    let trend: 'improving' | 'declining' | 'stable' = 'stable';
    if (recentAvg > olderAvg + 1) trend = 'improving';
    else if (recentAvg < olderAvg - 1) trend = 'declining';

    return { current, trend };
  }

  private calculateResponseTimeMetrics(records: any[]): {
    average: number;
    p95: number;
    p99: number;
  } {
    if (records.length === 0) return { average: 0, p95: 0, p99: 0 };

    const responseTimes = records.map(r => r.avg_response_time || 0).filter(t => t > 0);
    responseTimes.sort((a, b) => a - b);

    const average = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
    const p95Index = Math.ceil(responseTimes.length * 0.95) - 1;
    const p99Index = Math.ceil(responseTimes.length * 0.99) - 1;

    return {
      average,
      p95: responseTimes[p95Index] || 0,
      p99: responseTimes[p99Index] || 0
    };
  }

  private calculateResolutionTimeMetrics(records: any[]): {
    [priority: string]: {
      current: number;
      target: number;
      breaches: number;
    };
  } {
    const result: any = {};

    if (records.length === 0) return result;

    for (let priority = 1; priority <= 5; priority++) {
      const priorityKey = `priority_${priority}_avg`;
      const times = records
        .map(r => r.resolution_times?.[priorityKey] || 0)
        .filter(t => t > 0);

      const current = times.length > 0 
        ? times.reduce((sum, time) => sum + time, 0) / times.length 
        : 0;

      result[priority.toString()] = {
        current,
        target: 0, // Will be set by caller
        breaches: 0 // Will be calculated by caller
      };
    }

    return result;
  }

  private calculateComplianceMetrics(
    sla: any,
    availability: any,
    responseTime: any,
    resolutionTime: any
  ): {
    overall: number;
    byMetric: {
      availability: number;
      responseTime: number;
      resolutionTime: number;
    };
  } {
    const availabilityCompliance = availability.current >= sla.availability_target ? 100 : 0;
    const responseTimeCompliance = responseTime.average <= sla.response_time_target ? 100 : 0;

    // Calculate resolution time compliance
    let resolutionCompliantCount = 0;
    let totalResolutionChecks = 0;

    for (let priority = 1; priority <= 5; priority++) {
      const targetKey = `priority_${priority}`;
      const target = sla.resolution_time_targets[targetKey];
      
      if (target && resolutionTime[priority.toString()]) {
        totalResolutionChecks++;
        if (resolutionTime[priority.toString()].current <= target) {
          resolutionCompliantCount++;
        }
      }
    }

    const resolutionTimeCompliance = totalResolutionChecks > 0 
      ? (resolutionCompliantCount / totalResolutionChecks) * 100 
      : 100;

    const overall = (availabilityCompliance + responseTimeCompliance + resolutionTimeCompliance) / 3;

    return {
      overall,
      byMetric: {
        availability: availabilityCompliance,
        responseTime: responseTimeCompliance,
        resolutionTime: resolutionTimeCompliance
      }
    };
  }

  private calculateWeightedResolutionTime(resolutionTimes: any): number {
    if (!resolutionTimes) return 0;

    let totalTime = 0;
    let count = 0;

    for (let priority = 1; priority <= 5; priority++) {
      const key = `priority_${priority}_avg`;
      if (resolutionTimes[key]) {
        totalTime += resolutionTimes[key];
        count++;
      }
    }

    return count > 0 ? totalTime / count : 0;
  }

  private checkResolutionTimeCompliance(
    actualTimes: any,
    targets: any
  ): { compliant: boolean; breaches: number } {
    let breaches = 0;

    for (let priority = 1; priority <= 5; priority++) {
      const targetKey = `priority_${priority}`;
      const target = targets[targetKey];
      
      if (target && actualTimes[priority.toString()]) {
        if (actualTimes[priority.toString()].current > target) {
          breaches++;
        }
      }
    }

    return {
      compliant: breaches === 0,
      breaches
    };
  }

  private async getSLABreaches(
    slaId: string,
    period: { start: Date; end: Date }
  ): Promise<ISLABreach[]> {
    return await this.knex('sla_breaches')
      .where('sla_id', slaId)
      .whereBetween('breach_start', [period.start, period.end])
      .select('*');
  }

  private async recordMonitoringResults(
    slaId: string,
    metrics: ISLAMetrics,
    breaches: ISLABreach[],
    warnings: ISLABreach[]
  ): Promise<void> {
    try {
      await this.knex('sla_monitoring_results').insert({
        result_id: this.generateId(),
        sla_id: slaId,
        monitoring_date: new Date(),
        metrics: JSON.stringify(metrics),
        breach_count: breaches.length,
        warning_count: warnings.length,
        overall_compliance: metrics.compliance.overall
      });
    } catch (error) {
      console.error('Error recording monitoring results:', error);
    }
  }

  private async sendSLAAlert(breach: ISLABreach, config: any): Promise<void> {
    // Implementation would integrate with notification system
    // For now, just log the alert
    console.log('SLA Alert:', {
      breach: breach.breach_type,
      severity: breach.severity,
      service: breach.service_id,
      recipients: config.recipients
    });
  }

  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export default SLAMonitoringService;