// Example: Using Journey Tracking in a Ticket Creation Form
'use client';

import { useState } from 'react';
import { useJourneyTracking } from '../../../hooks/useJourneyTracking';
import { useSession } from 'next-auth/react';

export function TicketCreationForm() {
  const { data: session } = useSession();
  const { trackStep, completeJourney, trackError } = useJourneyTracking(
    'ticket_creation',
    session?.user?.id
  );

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: '',
    assignedTo: ''
  });

  // Track when form is opened
  useEffect(() => {
    trackStep({
      stepName: 'ticket_form_opened',
      metadata: {
        form_version: 'v2',
        entry_point: 'dashboard'
      }
    });
  }, []);

  // Track when ticket details are filled
  const handleTitleChange = (value: string) => {
    setFormData({ ...formData, title: value });
    
    if (value.length > 5 && !formData.description) {
      trackStep({
        stepName: 'ticket_details_filled',
        metadata: {
          title_length: value.length,
          has_description: false
        }
      });
    }
  };

  // Track priority selection
  const handlePriorityChange = (priority: string) => {
    setFormData({ ...formData, priority });
    
    trackStep({
      stepName: 'ticket_priority_set',
      metadata: {
        priority_level: priority,
        time_to_set_priority: Date.now() - startTime
      }
    });
  };

  // Track assignment
  const handleAssigneeChange = (assigneeId: string) => {
    setFormData({ ...formData, assignedTo: assigneeId });
    
    trackStep({
      stepName: 'ticket_assigned',
      metadata: {
        assignment_type: assigneeId ? 'manual' : 'unassigned',
        assigned_to_self: assigneeId === session?.user?.id
      }
    });
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      // Validate form
      if (!formData.title) {
        throw new Error('Title is required');
      }

      // Track submission step
      trackStep({
        stepName: 'ticket_submitted',
        metadata: {
          has_all_fields: !!(formData.title && formData.description && formData.priority && formData.assignedTo)
        }
      });

      // Submit ticket
      const response = await createTicket(formData);
      
      if (response.success) {
        // Complete the journey successfully
        completeJourney(true, {
          ticket_id: response.ticket.id,
          submission_attempts: 1,
          form_completion_time: Date.now() - startTime
        });
      } else {
        throw new Error(response.error);
      }
    } catch (error) {
      // Track error and recovery attempt
      trackError(
        error.message,
        'retry_submission',
        false
      );
      
      // If user gives up, the journey will be marked as abandoned
      // when the component unmounts
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Form fields */}
    </form>
  );
}

// Example: Error Recovery Tracking
export function TicketFormWithErrorRecovery() {
  const { trackError } = useJourneyTracking('ticket_creation', userId);
  
  const handleValidationError = (field: string) => {
    // Track that an error occurred
    trackError(
      `validation_error_${field}`,
      'show_inline_help',
      true // Recovery was successful (we showed help)
    );
  };
  
  const handleNetworkError = async () => {
    // Track network error
    trackError(
      'network_error',
      'auto_retry',
      false // Will update based on retry result
    );
    
    // Attempt recovery
    const retrySuccess = await retrySubmission();
    
    if (retrySuccess) {
      trackError(
        'network_error',
        'auto_retry_success',
        true
      );
    } else {
      trackError(
        'network_error',
        'save_draft_locally',
        true // We successfully saved a draft
      );
    }
  };
}

// Example: Complex Journey with Conditional Steps
export function OnboardingFlow() {
  const { trackStep, completeJourney } = useJourneyTracking('onboarding', userId);
  
  // Track each onboarding step
  const completeAccountCreation = () => {
    trackStep({
      stepName: 'account_created',
      metadata: {
        signup_method: 'email',
        referral_source: 'organic'
      }
    });
  };
  
  const completeCompanySetup = (companyData: any) => {
    trackStep({
      stepName: 'company_setup',
      metadata: {
        company_size: companyData.size,
        industry: companyData.industry,
        has_logo: !!companyData.logo
      }
    });
  };
  
  const inviteTeamMembers = (inviteCount: number) => {
    if (inviteCount > 0) {
      trackStep({
        stepName: 'team_invited',
        metadata: {
          invite_count: inviteCount,
          used_bulk_invite: inviteCount > 5
        }
      });
    }
  };
  
  // Complete onboarding
  const finishOnboarding = () => {
    completeJourney(true, {
      skipped_steps: ['first_invoice_generated'], // User didn't complete all steps
      onboarding_duration_days: 3,
      engagement_score: calculateEngagementScore()
    });
  };
}