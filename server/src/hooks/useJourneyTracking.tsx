'use client';

import { useEffect, useRef } from 'react';
import { usePostHog } from 'posthog-js/react';

interface JourneyStep {
  stepName: string;
  metadata?: Record<string, any>;
}

export function useJourneyTracking(
  journeyName: 'onboarding' | 'ticket_creation' | 'invoice_generation' | 'time_tracking' | 'report_creation',
  userId?: string
) {
  const posthog = usePostHog();
  const journeyIdRef = useRef<string | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const stepsCompletedRef = useRef<string[]>([]);

  useEffect(() => {
    if (!posthog || !userId) return;

    // Start the journey
    const journeyId = `${userId}_${journeyName}_${Date.now()}`;
    journeyIdRef.current = journeyId;

    posthog.capture('journey_started', {
      journey_id: journeyId,
      journey_name: journeyName,
      user_id: userId
    });

    // Cleanup function
    return () => {
      if (journeyIdRef.current) {
        // Journey was abandoned if we unmount without completing
        const duration = Date.now() - startTimeRef.current;
        posthog.capture('journey_abandoned', {
          journey_id: journeyIdRef.current,
          journey_name: journeyName,
          duration_ms: duration,
          steps_completed: stepsCompletedRef.current,
          last_step: stepsCompletedRef.current[stepsCompletedRef.current.length - 1],
          completion_rate: (stepsCompletedRef.current.length / getExpectedSteps(journeyName).length) * 100
        });
      }
    };
  }, [posthog, journeyName, userId]);

  const trackStep = (step: JourneyStep) => {
    if (!posthog || !journeyIdRef.current) return;

    stepsCompletedRef.current.push(step.stepName);
    
    posthog.capture('journey_step_completed', {
      journey_id: journeyIdRef.current,
      journey_name: journeyName,
      step_name: step.stepName,
      step_order: stepsCompletedRef.current.length,
      time_since_start: Date.now() - startTimeRef.current,
      ...step.metadata
    });
  };

  const completeJourney = (success: boolean = true, metadata?: Record<string, any>) => {
    if (!posthog || !journeyIdRef.current) return;

    const duration = Date.now() - startTimeRef.current;
    const expectedSteps = getExpectedSteps(journeyName);
    
    posthog.capture('journey_completed', {
      journey_id: journeyIdRef.current,
      journey_name: journeyName,
      success,
      duration_ms: duration,
      total_steps: stepsCompletedRef.current.length,
      expected_steps: expectedSteps.length,
      completion_rate: (stepsCompletedRef.current.length / expectedSteps.length) * 100,
      steps_skipped: expectedSteps.filter(s => !stepsCompletedRef.current.includes(s)),
      ...metadata
    });

    // Clear the journey ID so we don't track abandonment
    journeyIdRef.current = null;
  };

  const trackError = (errorType: string, recoveryAction: string, success: boolean) => {
    if (!posthog) return;

    posthog.capture('error_recovery_attempted', {
      journey_id: journeyIdRef.current,
      journey_name: journeyName,
      error_type: errorType,
      recovery_action: recoveryAction,
      recovery_success: success,
      current_step: stepsCompletedRef.current[stepsCompletedRef.current.length - 1]
    });
  };

  return {
    trackStep,
    completeJourney,
    trackError
  };
}

// Helper function to define expected steps for each journey
function getExpectedSteps(journeyName: string): string[] {
  const journeySteps: Record<string, string[]> = {
    onboarding: [
      'account_created',
      'company_setup',
      'team_invited',
      'first_ticket_created',
      'first_time_entry',
      'first_invoice_generated'
    ],
    ticket_creation: [
      'ticket_form_opened',
      'ticket_details_filled',
      'ticket_priority_set',
      'ticket_assigned',
      'ticket_submitted'
    ],
    invoice_generation: [
      'billing_cycle_selected',
      'invoice_preview',
      'invoice_adjustments',
      'invoice_generated',
      'invoice_sent'
    ],
    time_tracking: [
      'timer_started',
      'work_item_selected',
      'time_entry_saved',
      'timesheet_reviewed',
      'timesheet_submitted'
    ],
    report_creation: [
      'report_type_selected',
      'filters_applied',
      'report_generated',
      'report_exported'
    ]
  };

  return journeySteps[journeyName] || [];
}