import { analytics } from './posthog';
import { AnalyticsEvents } from './events';

export interface JourneyStep {
  step_name: string;
  step_order: number;
  time_spent?: number;
  completed: boolean;
  metadata?: Record<string, any>;
}

export interface UserJourney {
  journey_id: string;
  journey_name: string;
  user_id: string;
  started_at: string;
  completed_at?: string;
  steps: JourneyStep[];
  total_duration?: number;
  completion_rate: number;
}

export class JourneyTracker {
  private activeJourneys: Map<string, UserJourney> = new Map();

  /**
   * Start tracking a user journey
   */
  startJourney(
    userId: string,
    journeyName: 'onboarding' | 'ticket_creation' | 'invoice_generation' | 'time_tracking' | 'report_creation',
    metadata?: Record<string, any>
  ): string {
    const journeyId = `${userId}_${journeyName}_${Date.now()}`;
    
    const journey: UserJourney = {
      journey_id: journeyId,
      journey_name: journeyName,
      user_id: userId,
      started_at: new Date().toISOString(),
      steps: [],
      completion_rate: 0
    };

    this.activeJourneys.set(journeyId, journey);

    // Track journey start
    analytics.capture('journey_started', {
      journey_id: journeyId,
      journey_name: journeyName,
      ...metadata
    }, userId);

    return journeyId;
  }

  /**
   * Track a step in the journey
   */
  trackStep(
    journeyId: string,
    stepName: string,
    completed: boolean = true,
    metadata?: Record<string, any>
  ): void {
    const journey = this.activeJourneys.get(journeyId);
    if (!journey) return;

    const stepOrder = journey.steps.length + 1;
    const previousStepTime = journey.steps[journey.steps.length - 1]?.time_spent || 0;
    
    const step: JourneyStep = {
      step_name: stepName,
      step_order: stepOrder,
      completed,
      time_spent: Date.now() - new Date(journey.started_at).getTime() - previousStepTime,
      metadata
    };

    journey.steps.push(step);

    // Track individual step
    analytics.capture('journey_step_completed', {
      journey_id: journeyId,
      journey_name: journey.journey_name,
      step_name: stepName,
      step_order: stepOrder,
      step_duration: step.time_spent,
      completed,
      ...metadata
    }, journey.user_id);

    // Update completion rate
    const completedSteps = journey.steps.filter(s => s.completed).length;
    journey.completion_rate = (completedSteps / journey.steps.length) * 100;
  }

  /**
   * Complete a journey
   */
  completeJourney(
    journeyId: string,
    success: boolean = true,
    metadata?: Record<string, any>
  ): void {
    const journey = this.activeJourneys.get(journeyId);
    if (!journey) return;

    journey.completed_at = new Date().toISOString();
    journey.total_duration = new Date(journey.completed_at).getTime() - new Date(journey.started_at).getTime();

    // Track journey completion
    analytics.capture('journey_completed', {
      journey_id: journeyId,
      journey_name: journey.journey_name,
      success,
      total_duration: journey.total_duration,
      total_steps: journey.steps.length,
      completed_steps: journey.steps.filter(s => s.completed).length,
      completion_rate: journey.completion_rate,
      ...metadata
    }, journey.user_id);

    // Clean up
    this.activeJourneys.delete(journeyId);
  }

  /**
   * Abandon a journey (user didn't complete it)
   */
  abandonJourney(
    journeyId: string,
    reason?: string,
    metadata?: Record<string, any>
  ): void {
    const journey = this.activeJourneys.get(journeyId);
    if (!journey) return;

    const duration = Date.now() - new Date(journey.started_at).getTime();

    analytics.capture('journey_abandoned', {
      journey_id: journeyId,
      journey_name: journey.journey_name,
      abandon_reason: reason,
      duration_before_abandon: duration,
      last_completed_step: journey.steps.filter(s => s.completed).pop()?.step_name,
      completion_rate: journey.completion_rate,
      ...metadata
    }, journey.user_id);

    // Clean up
    this.activeJourneys.delete(journeyId);
  }

  /**
   * Track error recovery in a journey
   */
  trackErrorRecovery(
    userId: string,
    errorType: string,
    recoveryAction: string,
    success: boolean,
    metadata?: Record<string, any>
  ): void {
    analytics.capture('error_recovery_attempted', {
      error_type: errorType,
      recovery_action: recoveryAction,
      recovery_success: success,
      ...metadata
    }, userId);
  }
}

// Singleton instance
export const journeyTracker = new JourneyTracker();

// Predefined journey templates
export const JourneyTemplates = {
  ONBOARDING: {
    name: 'onboarding',
    steps: [
      'account_created',
      'company_setup',
      'team_invited',
      'first_ticket_created',
      'first_time_entry',
      'first_invoice_generated'
    ]
  },
  TICKET_WORKFLOW: {
    name: 'ticket_creation',
    steps: [
      'ticket_form_opened',
      'ticket_details_filled',
      'ticket_priority_set',
      'ticket_assigned',
      'ticket_submitted'
    ]
  },
  INVOICE_WORKFLOW: {
    name: 'invoice_generation',
    steps: [
      'billing_cycle_selected',
      'invoice_preview',
      'invoice_adjustments',
      'invoice_generated',
      'invoice_sent'
    ]
  },
  TIME_TRACKING_WORKFLOW: {
    name: 'time_tracking',
    steps: [
      'timer_started',
      'work_item_selected',
      'time_entry_saved',
      'timesheet_reviewed',
      'timesheet_submitted'
    ]
  }
};