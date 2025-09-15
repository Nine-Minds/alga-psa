import { Knex } from 'knex';
import { ICustomerSatisfactionSurvey, ICustomerSatisfactionResponse } from '../../interfaces/service.interfaces';

export interface ICSATMetrics {
  csat: {
    score: number; // 1-5 scale average
    responseCount: number;
    distribution: { [score: number]: number };
    trend: 'improving' | 'declining' | 'stable';
  };
  nps: {
    score: number; // -100 to +100
    responseCount: number;
    distribution: {
      promoters: number; // 9-10 scores
      passives: number;  // 7-8 scores
      detractors: number; // 0-6 scores
    };
    trend: 'improving' | 'declining' | 'stable';
  };
  ces: {
    score: number; // 1-7 scale average (lower is better)
    responseCount: number;
    distribution: { [score: number]: number };
    trend: 'improving' | 'declining' | 'stable';
  };
  overall: {
    satisfactionRate: number; // Percentage of satisfied customers
    responseRate: number; // Survey response rate
    followUpRate: number; // Percentage requesting follow-up
  };
}

export interface ISurveyTrigger {
  trigger_id: string;
  survey_id: string;
  triggered_by: string; // Event that triggered the survey
  trigger_data: any; // Context data (ticket ID, service ID, etc.)
  triggered_at: Date;
  sent_at?: Date;
  responded_at?: Date;
  response_id?: string;
}

export class CustomerSatisfactionService {
  constructor(private knex: Knex) {}

  /**
   * Create a new customer satisfaction survey
   */
  async createSurvey(surveyData: Omit<ICustomerSatisfactionSurvey, 'survey_id' | 'created_date'>): Promise<string> {
    try {
      const [survey] = await this.knex('customer_satisfaction_surveys').insert({
        survey_id: this.knex.raw('uuid_generate_v4()'),
        ...surveyData,
        created_date: new Date()
      }).returning('survey_id');

      // Log survey creation
      await this.logSurveyEvent({
        survey_id: survey.survey_id,
        event_type: 'survey_created',
        details: {
          survey_type: surveyData.survey_type,
          title: surveyData.title,
          trigger_type: surveyData.trigger_type
        },
        performed_by: surveyData.created_by
      });

      return survey.survey_id;
    } catch (error) {
      console.error('Error creating survey:', error);
      throw error;
    }
  }

  /**
   * Trigger surveys based on events (ticket closure, scheduled, etc.)
   */
  async triggerSurveys(eventType: string, eventData: any): Promise<void> {
    try {
      // Find active surveys that match the trigger type
      const matchingSurveys = await this.knex('customer_satisfaction_surveys')
        .where('status', 'active')
        .where('trigger_type', eventType)
        .select('*');

      for (const survey of matchingSurveys) {
        // Check if trigger conditions are met
        if (await this.evaluateTriggerConditions(survey, eventData)) {
          await this.scheduleSurveyDelivery(survey, eventData);
        }
      }
    } catch (error) {
      console.error('Error triggering surveys:', error);
    }
  }

  /**
   * Schedule survey delivery to customers
   */
  async scheduleSurveyDelivery(survey: ICustomerSatisfactionSurvey, eventData: any): Promise<void> {
    try {
      // Determine recipients based on survey configuration
      const recipients = await this.geteSurveyRecipients(survey, eventData);

      for (const recipient of recipients) {
        // Check if customer should receive survey (rate limiting, etc.)
        if (await this.shouldSendSurvey(survey, recipient, eventData)) {
          const triggerId = await this.createSurveyTrigger({
            survey_id: survey.survey_id,
            triggered_by: eventData.event_type || 'manual',
            trigger_data: eventData,
            recipient: recipient
          });

          // Schedule delivery with delay if configured
          if (survey.send_delay_minutes > 0) {
            await this.scheduleDelayedDelivery(triggerId, survey.send_delay_minutes);
          } else {
            await this.deliverSurvey(triggerId);
          }
        }
      }
    } catch (error) {
      console.error('Error scheduling survey delivery:', error);
    }
  }

  /**
   * Record customer survey response
   */
  async recordResponse(
    surveyId: string,
    responseData: Omit<ICustomerSatisfactionResponse, 'response_id' | 'survey_id' | 'response_date'>
  ): Promise<string> {
    try {
      // Calculate scores based on response data
      const calculatedScores = this.calculateScores(surveyId, responseData.responses);

      const [response] = await this.knex('customer_satisfaction_responses').insert({
        response_id: this.knex.raw('uuid_generate_v4()'),
        survey_id: surveyId,
        ...responseData,
        ...calculatedScores,
        response_date: new Date()
      }).returning('response_id');

      // Update survey trigger record
      if (responseData.trigger_id) {
        await this.knex('survey_triggers')
          .where('trigger_id', responseData.trigger_id)
          .update({
            responded_at: new Date(),
            response_id: response.response_id
          });
      }

      // Schedule follow-up if requested
      if (responseData.follow_up_requested) {
        await this.scheduleFollowUp(response.response_id);
      }

      // Process alerts for low satisfaction scores
      await this.processLowSatisfactionAlert(surveyId, response.response_id, calculatedScores);

      return response.response_id;
    } catch (error) {
      console.error('Error recording response:', error);
      throw error;
    }
  }

  /**
   * Calculate comprehensive CSAT metrics for a service or tenant
   */
  async calculateCSATMetrics(
    filters: {
      tenant?: string;
      service_ids?: string[];
      customer_ids?: string[];
      date_range?: {
        start: Date;
        end: Date;
      };
      survey_types?: string[];
    }
  ): Promise<ICSATMetrics> {
    try {
      let query = this.knex('customer_satisfaction_responses')
        .join('customer_satisfaction_surveys', 
          'customer_satisfaction_responses.survey_id', 
          'customer_satisfaction_surveys.survey_id');

      // Apply filters
      if (filters.tenant) {
        query = query.where('customer_satisfaction_surveys.tenant', filters.tenant);
      }

      if (filters.service_ids && filters.service_ids.length > 0) {
        query = query.whereIn('customer_satisfaction_responses.service_id', filters.service_ids);
      }

      if (filters.customer_ids && filters.customer_ids.length > 0) {
        query = query.whereIn('customer_satisfaction_responses.customer_id', filters.customer_ids);
      }

      if (filters.date_range) {
        query = query.whereBetween('customer_satisfaction_responses.response_date', 
          [filters.date_range.start, filters.date_range.end]);
      }

      if (filters.survey_types && filters.survey_types.length > 0) {
        query = query.whereIn('customer_satisfaction_surveys.survey_type', filters.survey_types);
      }

      const responses = await query.select(
        'customer_satisfaction_responses.*',
        'customer_satisfaction_surveys.survey_type'
      );

      // Calculate CSAT metrics
      const csatResponses = responses.filter(r => r.csat_score !== null);
      const csatMetrics = this.calculateCSATScoreMetrics(csatResponses.map(r => r.csat_score));

      // Calculate NPS metrics
      const npsResponses = responses.filter(r => r.nps_score !== null);
      const npsMetrics = this.calculateNPSMetrics(npsResponses.map(r => r.nps_score));

      // Calculate CES metrics
      const cesResponses = responses.filter(r => r.ces_score !== null);
      const cesMetrics = this.calculateCESMetrics(cesResponses.map(r => r.ces_score));

      // Calculate overall metrics
      const totalSurveysSent = await this.getTotalSurveysSent(filters);
      const followUpRequests = responses.filter(r => r.follow_up_requested).length;

      return {
        csat: {
          score: csatMetrics.average,
          responseCount: csatResponses.length,
          distribution: csatMetrics.distribution,
          trend: await this.calculateTrend('csat', filters)
        },
        nps: {
          score: npsMetrics.score,
          responseCount: npsResponses.length,
          distribution: npsMetrics.distribution,
          trend: await this.calculateTrend('nps', filters)
        },
        ces: {
          score: cesMetrics.average,
          responseCount: cesResponses.length,
          distribution: cesMetrics.distribution,
          trend: await this.calculateTrend('ces', filters)
        },
        overall: {
          satisfactionRate: this.calculateSatisfactionRate(responses),
          responseRate: totalSurveysSent > 0 ? (responses.length / totalSurveysSent) * 100 : 0,
          followUpRate: responses.length > 0 ? (followUpRequests / responses.length) * 100 : 0
        }
      };
    } catch (error) {
      console.error('Error calculating CSAT metrics:', error);
      throw error;
    }
  }

  /**
   * Get customer satisfaction trends over time
   */
  async getCSATTrends(
    filters: {
      tenant?: string;
      service_ids?: string[];
      period_days: number;
      group_by: 'day' | 'week' | 'month';
    }
  ): Promise<Array<{
    period: string;
    csat_score: number;
    nps_score: number;
    ces_score: number;
    response_count: number;
    satisfaction_rate: number;
  }>> {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - filters.period_days);

      let dateFormat = 'YYYY-MM-DD';
      let dateInterval = '1 day';

      switch (filters.group_by) {
        case 'week':
          dateFormat = 'YYYY-"W"WW';
          dateInterval = '1 week';
          break;
        case 'month':
          dateFormat = 'YYYY-MM';
          dateInterval = '1 month';
          break;
      }

      let query = this.knex('customer_satisfaction_responses')
        .join('customer_satisfaction_surveys', 
          'customer_satisfaction_responses.survey_id', 
          'customer_satisfaction_surveys.survey_id')
        .whereBetween('customer_satisfaction_responses.response_date', [startDate, endDate]);

      if (filters.tenant) {
        query = query.where('customer_satisfaction_surveys.tenant', filters.tenant);
      }

      if (filters.service_ids && filters.service_ids.length > 0) {
        query = query.whereIn('customer_satisfaction_responses.service_id', filters.service_ids);
      }

      const results = await query
        .select(
          this.knex.raw(`DATE_TRUNC('${filters.group_by}', response_date) as period`),
          this.knex.raw('AVG(csat_score) as avg_csat'),
          this.knex.raw('AVG(CASE WHEN nps_score IS NOT NULL THEN (nps_score * 10 - 100) END) as avg_nps'),
          this.knex.raw('AVG(ces_score) as avg_ces'),
          this.knex.raw('COUNT(*) as response_count'),
          this.knex.raw('AVG(CASE WHEN overall_satisfaction >= 4 THEN 1.0 ELSE 0.0 END) * 100 as satisfaction_rate')
        )
        .groupBy(this.knex.raw('DATE_TRUNC(?, response_date)', [filters.group_by]))
        .orderBy('period');

      return results.map(result => ({
        period: result.period.toISOString().split('T')[0],
        csat_score: parseFloat(result.avg_csat) || 0,
        nps_score: parseFloat(result.avg_nps) || 0,
        ces_score: parseFloat(result.avg_ces) || 0,
        response_count: parseInt(result.response_count),
        satisfaction_rate: parseFloat(result.satisfaction_rate) || 0
      }));
    } catch (error) {
      console.error('Error getting CSAT trends:', error);
      throw error;
    }
  }

  /**
   * Get customer feedback and comments
   */
  async getCustomerFeedback(
    filters: {
      tenant?: string;
      service_ids?: string[];
      satisfaction_threshold?: number; // Only get feedback below this threshold
      include_follow_up_requests?: boolean;
      limit?: number;
      offset?: number;
    }
  ): Promise<{
    feedback: Array<{
      response_id: string;
      customer_name?: string;
      service_name?: string;
      satisfaction_score: number;
      feedback_text: string;
      response_date: Date;
      follow_up_requested: boolean;
      follow_up_completed: boolean;
    }>;
    total: number;
  }> {
    try {
      let query = this.knex('customer_satisfaction_responses')
        .join('customer_satisfaction_surveys', 
          'customer_satisfaction_responses.survey_id', 
          'customer_satisfaction_surveys.survey_id')
        .leftJoin('services', 'customer_satisfaction_responses.service_id', 'services.service_id')
        .leftJoin('contacts', 'customer_satisfaction_responses.contact_id', 'contacts.contact_name_id');

      // Apply filters
      if (filters.tenant) {
        query = query.where('customer_satisfaction_surveys.tenant', filters.tenant);
      }

      if (filters.service_ids && filters.service_ids.length > 0) {
        query = query.whereIn('customer_satisfaction_responses.service_id', filters.service_ids);
      }

      if (filters.satisfaction_threshold !== undefined) {
        query = query.where(function() {
          this.where('overall_satisfaction', '<=', filters.satisfaction_threshold)
            .orWhere('csat_score', '<=', filters.satisfaction_threshold);
        });
      }

      if (filters.include_follow_up_requests) {
        query = query.where('follow_up_requested', true);
      }

      // Get total count
      const totalResult = await query.clone().count('* as total').first();
      const total = parseInt(totalResult?.total as string) || 0;

      // Apply pagination
      if (filters.limit) {
        query = query.limit(filters.limit);
      }
      if (filters.offset) {
        query = query.offset(filters.offset);
      }

      // Get text responses
      query = query.whereNotNull(
        this.knex.raw("responses::jsonb -> 'response_text'")
      );

      const results = await query
        .select(
          'customer_satisfaction_responses.response_id',
          'contacts.full_name as customer_name',
          'services.service_name',
          'customer_satisfaction_responses.overall_satisfaction as satisfaction_score',
          this.knex.raw("responses::jsonb -> 'response_text' as feedback_text"),
          'customer_satisfaction_responses.response_date',
          'customer_satisfaction_responses.follow_up_requested',
          'customer_satisfaction_responses.follow_up_completed'
        )
        .orderBy('customer_satisfaction_responses.response_date', 'desc');

      return {
        feedback: results.map(result => ({
          response_id: result.response_id,
          customer_name: result.customer_name,
          service_name: result.service_name,
          satisfaction_score: result.satisfaction_score || 0,
          feedback_text: result.feedback_text || '',
          response_date: result.response_date,
          follow_up_requested: result.follow_up_requested,
          follow_up_completed: result.follow_up_completed
        })),
        total
      };
    } catch (error) {
      console.error('Error getting customer feedback:', error);
      throw error;
    }
  }

  /**
   * Generate customer satisfaction report
   */
  async generateCSATReport(
    tenant: string,
    reportConfig: {
      services?: string[];
      period: {
        start: Date;
        end: Date;
      };
      include_trends: boolean;
      include_feedback: boolean;
      include_benchmarks: boolean;
    }
  ): Promise<{
    summary: ICSATMetrics;
    trends?: any[];
    feedback?: any[];
    benchmarks?: any;
    recommendations: string[];
  }> {
    try {
      const filters = {
        tenant,
        service_ids: reportConfig.services,
        date_range: reportConfig.period
      };

      // Get overall metrics
      const summary = await this.calculateCSATMetrics(filters);

      // Get trends if requested
      let trends;
      if (reportConfig.include_trends) {
        trends = await this.getCSATTrends({
          tenant,
          service_ids: reportConfig.services,
          period_days: Math.ceil((reportConfig.period.end.getTime() - reportConfig.period.start.getTime()) / (1000 * 60 * 60 * 24)),
          group_by: 'week'
        });
      }

      // Get feedback if requested
      let feedback;
      if (reportConfig.include_feedback) {
        const feedbackResult = await this.getCustomerFeedback({
          tenant,
          service_ids: reportConfig.services,
          satisfaction_threshold: 3,
          limit: 100
        });
        feedback = feedbackResult.feedback;
      }

      // Get industry benchmarks if requested
      let benchmarks;
      if (reportConfig.include_benchmarks) {
        benchmarks = await this.getIndustryBenchmarks();
      }

      // Generate recommendations
      const recommendations = this.generateRecommendations(summary, trends, benchmarks);

      return {
        summary,
        trends,
        feedback,
        benchmarks,
        recommendations
      };
    } catch (error) {
      console.error('Error generating CSAT report:', error);
      throw error;
    }
  }

  /**
   * Helper Methods
   */
  private async evaluateTriggerConditions(survey: ICustomerSatisfactionSurvey, eventData: any): Promise<boolean> {
    if (!survey.trigger_conditions) return true;

    const conditions = survey.trigger_conditions;

    // Check service IDs
    if (conditions.service_ids && conditions.service_ids.length > 0) {
      if (!eventData.service_id || !conditions.service_ids.includes(eventData.service_id)) {
        return false;
      }
    }

    // Check priority levels
    if (conditions.priority_levels && conditions.priority_levels.length > 0) {
      if (!eventData.priority || !conditions.priority_levels.includes(eventData.priority)) {
        return false;
      }
    }

    // Check resolution time threshold
    if (conditions.resolution_time_threshold) {
      const resolutionTimeHours = eventData.resolution_time_hours || 0;
      if (resolutionTimeHours < conditions.resolution_time_threshold) {
        return false;
      }
    }

    return true;
  }

  private async geteSurveyRecipients(survey: ICustomerSatisfactionSurvey, eventData: any): Promise<any[]> {
    const recipients = [];

    switch (survey.target_audience) {
      case 'all_customers':
        // Get all customers for the tenant
        const allCustomers = await this.knex('contacts')
          .where('tenant', survey.tenant)
          .where('is_active', true)
          .select('*');
        recipients.push(...allCustomers);
        break;

      case 'specific_customers':
        if (survey.customer_filter?.contact_ids) {
          const specificCustomers = await this.knex('contacts')
            .whereIn('contact_name_id', survey.customer_filter.contact_ids)
            .select('*');
          recipients.push(...specificCustomers);
        }
        break;

      case 'service_users':
        // Get users based on the event (e.g., ticket requester)
        if (eventData.contact_id) {
          const serviceUser = await this.knex('contacts')
            .where('contact_name_id', eventData.contact_id)
            .first();
          if (serviceUser) recipients.push(serviceUser);
        }
        break;
    }

    return recipients;
  }

  private async shouldSendSurvey(
    survey: ICustomerSatisfactionSurvey,
    recipient: any,
    eventData: any
  ): Promise<boolean> {
    // Check response limit
    if (survey.response_limit) {
      const period = new Date();
      period.setMonth(period.getMonth() - 1); // Last month

      const recentResponses = await this.knex('customer_satisfaction_responses')
        .where('survey_id', survey.survey_id)
        .where('contact_id', recipient.contact_name_id)
        .where('response_date', '>=', period)
        .count('* as count')
        .first();

      if (parseInt(recentResponses?.count as string) >= survey.response_limit) {
        return false;
      }
    }

    return true;
  }

  private async createSurveyTrigger(triggerData: {
    survey_id: string;
    triggered_by: string;
    trigger_data: any;
    recipient: any;
  }): Promise<string> {
    const [trigger] = await this.knex('survey_triggers').insert({
      trigger_id: this.knex.raw('uuid_generate_v4()'),
      survey_id: triggerData.survey_id,
      triggered_by: triggerData.triggered_by,
      trigger_data: JSON.stringify(triggerData.trigger_data),
      recipient_id: triggerData.recipient.contact_name_id,
      triggered_at: new Date()
    }).returning('trigger_id');

    return trigger.trigger_id;
  }

  private async scheduleDelayedDelivery(triggerId: string, delayMinutes: number): Promise<void> {
    const deliveryTime = new Date();
    deliveryTime.setMinutes(deliveryTime.getMinutes() + delayMinutes);

    // In a real implementation, this would integrate with a job scheduler
    console.log(`Survey delivery scheduled for ${deliveryTime} (trigger: ${triggerId})`);
  }

  private async deliverSurvey(triggerId: string): Promise<void> {
    // Update trigger record
    await this.knex('survey_triggers')
      .where('trigger_id', triggerId)
      .update({ sent_at: new Date() });

    // In a real implementation, this would send the actual survey
    console.log(`Survey delivered for trigger: ${triggerId}`);
  }

  private calculateScores(surveyId: string, responses: any[]): Partial<ICustomerSatisfactionResponse> {
    const scores: any = {};

    // Find CSAT responses (typically 1-5 scale)
    const csatResponse = responses.find(r => r.question_type === 'rating_scale' && r.scale_max === 5);
    if (csatResponse) {
      scores.csat_score = csatResponse.response_value;
    }

    // Find NPS responses (0-10 scale, converted to -100 to +100)
    const npsResponse = responses.find(r => r.question_type === 'nps_scale');
    if (npsResponse) {
      const npsValue = npsResponse.response_value;
      scores.nps_score = (npsValue * 10) - 100; // Convert 0-10 to -100 to +100
    }

    // Find CES responses (1-7 scale)
    const cesResponse = responses.find(r => r.question_type === 'rating_scale' && r.scale_max === 7);
    if (cesResponse) {
      scores.ces_score = cesResponse.response_value;
    }

    // Calculate overall satisfaction (use CSAT if available, otherwise average of available scores)
    if (scores.csat_score) {
      scores.overall_satisfaction = scores.csat_score;
    } else {
      const availableScores = [];
      if (scores.nps_score !== undefined) availableScores.push((scores.nps_score + 100) / 20); // Convert to 1-5 scale
      if (scores.ces_score !== undefined) availableScores.push(8 - scores.ces_score); // Invert CES (lower is better)
      
      if (availableScores.length > 0) {
        scores.overall_satisfaction = availableScores.reduce((a, b) => a + b, 0) / availableScores.length;
      }
    }

    return scores;
  }

  private calculateCSATScoreMetrics(scores: number[]): {
    average: number;
    distribution: { [score: number]: number };
  } {
    if (scores.length === 0) return { average: 0, distribution: {} };

    const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const distribution: { [score: number]: number } = {};

    for (let i = 1; i <= 5; i++) {
      distribution[i] = scores.filter(score => score === i).length;
    }

    return { average, distribution };
  }

  private calculateNPSMetrics(scores: number[]): {
    score: number;
    distribution: {
      promoters: number;
      passives: number;
      detractors: number;
    };
  } {
    if (scores.length === 0) {
      return { score: 0, distribution: { promoters: 0, passives: 0, detractors: 0 } };
    }

    // Convert from -100 to +100 scale back to 0-10 scale for calculation
    const originalScores = scores.map(score => (score + 100) / 10);

    const promoters = originalScores.filter(score => score >= 9).length;
    const passives = originalScores.filter(score => score >= 7 && score < 9).length;
    const detractors = originalScores.filter(score => score < 7).length;

    const npsScore = ((promoters - detractors) / originalScores.length) * 100;

    return {
      score: npsScore,
      distribution: { promoters, passives, detractors }
    };
  }

  private calculateCESMetrics(scores: number[]): {
    average: number;
    distribution: { [score: number]: number };
  } {
    if (scores.length === 0) return { average: 0, distribution: {} };

    const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const distribution: { [score: number]: number } = {};

    for (let i = 1; i <= 7; i++) {
      distribution[i] = scores.filter(score => score === i).length;
    }

    return { average, distribution };
  }

  private calculateSatisfactionRate(responses: any[]): number {
    if (responses.length === 0) return 0;

    const satisfiedCount = responses.filter(r => 
      (r.overall_satisfaction && r.overall_satisfaction >= 4) ||
      (r.csat_score && r.csat_score >= 4)
    ).length;

    return (satisfiedCount / responses.length) * 100;
  }

  private async calculateTrend(
    metricType: 'csat' | 'nps' | 'ces',
    filters: any
  ): Promise<'improving' | 'declining' | 'stable'> {
    // Simple trend calculation - compare last 30 days to previous 30 days
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    const sixtyDaysAgo = new Date(now.getTime() - (60 * 24 * 60 * 60 * 1000));

    const recentFilters = { ...filters, date_range: { start: thirtyDaysAgo, end: now } };
    const olderFilters = { ...filters, date_range: { start: sixtyDaysAgo, end: thirtyDaysAgo } };

    const recentMetrics = await this.calculateCSATMetrics(recentFilters);
    const olderMetrics = await this.calculateCSATMetrics(olderFilters);

    let recentValue = 0;
    let olderValue = 0;

    switch (metricType) {
      case 'csat':
        recentValue = recentMetrics.csat.score;
        olderValue = olderMetrics.csat.score;
        break;
      case 'nps':
        recentValue = recentMetrics.nps.score;
        olderValue = olderMetrics.nps.score;
        break;
      case 'ces':
        recentValue = recentMetrics.ces.score;
        olderValue = olderMetrics.ces.score;
        break;
    }

    const threshold = metricType === 'nps' ? 5 : 0.2; // Different thresholds for different metrics
    
    if (recentValue > olderValue + threshold) return 'improving';
    if (recentValue < olderValue - threshold) return 'declining';
    return 'stable';
  }

  private async getTotalSurveysSent(filters: any): Promise<number> {
    // This would query survey triggers to get total sent count
    // For now, return a calculated estimate
    return 100; // Placeholder
  }

  private async scheduleFollowUp(responseId: string): Promise<void> {
    // Create follow-up task or notification
    console.log(`Follow-up scheduled for response: ${responseId}`);
  }

  private async processLowSatisfactionAlert(
    surveyId: string,
    responseId: string,
    scores: any
  ): Promise<void> {
    const lowThreshold = 3;
    
    if (scores.overall_satisfaction && scores.overall_satisfaction <= lowThreshold) {
      // Create alert or notification for low satisfaction
      console.log(`Low satisfaction alert: Survey ${surveyId}, Response ${responseId}, Score: ${scores.overall_satisfaction}`);
    }
  }

  private async getIndustryBenchmarks(): Promise<any> {
    // Return industry benchmark data
    return {
      csat: { average: 4.2, good: 4.5, excellent: 4.8 },
      nps: { average: 30, good: 50, excellent: 70 },
      ces: { average: 3.5, good: 3.0, excellent: 2.5 }
    };
  }

  private generateRecommendations(
    summary: ICSATMetrics,
    trends?: any[],
    benchmarks?: any
  ): string[] {
    const recommendations: string[] = [];

    // CSAT recommendations
    if (summary.csat.score < 4.0) {
      recommendations.push('CSAT score is below acceptable threshold. Focus on improving service quality and response times.');
    }

    if (benchmarks && summary.csat.score < benchmarks.csat.average) {
      recommendations.push('CSAT score is below industry average. Consider benchmarking against competitors.');
    }

    // NPS recommendations
    if (summary.nps.score < 0) {
      recommendations.push('NPS score is negative. Immediate action required to address customer concerns.');
    }

    if (summary.nps.distribution.detractors > summary.nps.distribution.promoters) {
      recommendations.push('More detractors than promoters. Focus on converting detractors to passives.');
    }

    // Response rate recommendations
    if (summary.overall.responseRate < 20) {
      recommendations.push('Low survey response rate. Consider shortening surveys or improving incentives.');
    }

    // Follow-up recommendations
    if (summary.overall.followUpRate > 10) {
      recommendations.push('High follow-up request rate indicates unresolved customer concerns. Improve first-contact resolution.');
    }

    return recommendations;
  }

  private async logSurveyEvent(eventData: {
    survey_id: string;
    event_type: string;
    details: any;
    performed_by: string;
  }): Promise<void> {
    try {
      await this.knex('survey_audit_log').insert({
        id: this.knex.raw('uuid_generate_v4()'),
        survey_id: eventData.survey_id,
        event_type: eventData.event_type,
        details: JSON.stringify(eventData.details),
        performed_by: eventData.performed_by,
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Error logging survey event:', error);
    }
  }
}

export default CustomerSatisfactionService;