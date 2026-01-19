'use client';

import React, { useState, useEffect } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { WizardProgress } from './WizardProgress';
import { WizardNavigation } from './WizardNavigation';
import { ClientInfoStep } from './steps/ClientInfoStep';
import { TeamMembersStep } from './steps/TeamMembersStep';
import { AddClientStep } from './steps/AddClientStep';
import { ClientContactStep } from './steps/ClientContactStep';
import { BillingSetupStep } from './steps/BillingSetupStep';
import { TicketingConfigStep } from './steps/TicketingConfigStep';
import { WizardData, STEPS, REQUIRED_STEPS } from './types';
import {
  saveClientInfo,
  addTeamMembers,
  createClient,
  addClientContact,
  setupBilling,
  configureTicketing,
  completeOnboarding,
  validateOnboardingDefaults
} from '@alga-psa/onboarding/actions';

interface OnboardingWizardProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  testMode?: boolean;
  debugMode?: boolean;
  initialData?: Partial<WizardData>;
  onComplete?: (data: WizardData) => void;
  fullPage?: boolean;
  isRevisit?: boolean;
}

export function OnboardingWizard({
  open = true,
  onOpenChange,
  testMode = false,
  debugMode = false,
  initialData = {},
  onComplete,
  fullPage = false,
  isRevisit = false,
}: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [attemptedSteps, setAttemptedSteps] = useState<Set<number>>(new Set());
  const [wizardData, setWizardData] = useState<WizardData>({
    // MSP Company Info
    firstName: '',
    lastName: '',
    companyName: '',
    email: '',
    newPassword: '',
    confirmPassword: '',

    // Team Members
    teamMembers: [{ firstName: '', lastName: '', email: '', role: 'technician' }],

    // Client Info
    clientName: '',
    clientEmail: '',
    clientPhone: '',
    clientUrl: '',

    // Client Contact
    contactName: '',
    contactEmail: '',
    contactRole: '',

    // Billing
    serviceName: '',
    serviceDescription: '',
    servicePrice: '',
    contractLineName: 'hourly',

    // Ticketing
    boardName: '',
    boardId: undefined,
    supportEmail: '',
    categories: [],
    priorities: [],
    
    ...initialData,
  });

  useEffect(() => {
    if (debugMode) {
      console.log('Wizard State:', { currentStep, wizardData });
    }
  }, [currentStep, wizardData, debugMode]);

  const updateData = (data: Partial<WizardData>) => {
    setWizardData((prev) => ({ ...prev, ...data }));
  };

  const saveStepData = async (stepIndex: number): Promise<boolean> => {
    if (testMode) return true;
    
    setIsLoading(true);
    setErrors(prev => ({ ...prev, [stepIndex]: '' }));
    
    try {
      switch (stepIndex) {
        case 0: // Client Info
          const clientResult = await saveClientInfo({
            firstName: wizardData.firstName,
            lastName: wizardData.lastName,
            clientName: wizardData.clientName,
            email: wizardData.email,
            newPassword: wizardData.newPassword
          });
          if (!clientResult.success) {
            setErrors(prev => ({ ...prev, [stepIndex]: clientResult.error || 'Failed to save client info' }));
            return false;
          }
          break;
          
        case 1: // Team Members
          const validMembers = wizardData.teamMembers.filter(m => m.firstName && m.lastName && m.email);
          
          // Filter out already created team members
          const existingEmails = wizardData.createdTeamMemberEmails || [];
          const newMembers = validMembers.filter(m => !existingEmails.includes(m.email));
          
          
          if (newMembers.length > 0) {
            const teamResult = await addTeamMembers(newMembers);
            if (!teamResult.success) {
              setErrors(prev => ({ ...prev, [stepIndex]: teamResult.error || 'Failed to add team members' }));
              return false;
            }
            
            // Track created team member emails
            if (teamResult.data?.created && teamResult.data.created.length > 0) {
              const allCreated = [...new Set([...existingEmails, ...teamResult.data.created])];
              setWizardData(prev => ({ ...prev, createdTeamMemberEmails: allCreated }));
              
              // Show warning if some users were skipped
              if (teamResult.data.message) {
                setErrors(prev => ({ ...prev, [stepIndex]: teamResult.data.message }));
              }
            }
          }
          break;
          
        case 2: // Client
          if (wizardData.clientName) {
            const clientResult = await createClient({
              clientName: wizardData.clientName,
              clientEmail: wizardData.clientEmail,
              clientPhone: wizardData.clientPhone,
              clientUrl: wizardData.clientUrl,
              clientId: wizardData.clientId // Pass existing ID if available for updates
            });
            if (!clientResult.success) {
              setErrors(prev => ({ ...prev, [stepIndex]: clientResult.error || 'Failed to save client' }));
              return false;
            }
            // Store client ID for contact step (if it's a new client)
            if (clientResult.data?.clientId && !wizardData.clientId) {
              setWizardData(prev => ({ ...prev, clientId: clientResult.data.clientId }));
            }
          }
          break;
          
        case 3: // Client Contact
          if (wizardData.contactName && wizardData.clientId) {
            // Check if we already have a contactId (contact was already created)
            if (!wizardData.contactId) {
              const contactResult = await addClientContact({
                contactName: wizardData.contactName,
                contactEmail: wizardData.contactEmail,
                contactRole: wizardData.contactRole,
                clientId: wizardData.clientId
              });
              if (!contactResult.success) {
                setErrors(prev => ({ ...prev, [stepIndex]: contactResult.error || 'Failed to add contact' }));
                return false;
              }
              // Store contact ID
              if (contactResult.data?.contactId) {
                setWizardData(prev => ({ ...prev, contactId: contactResult.data.contactId }));
              }
            }
            // If contactId exists, we've already created this contact, just proceed
          }
          break;
          
        case 4: // Billing
          if (wizardData.serviceName) {
            // Check if we already have a serviceId (service was already created)
            if (!wizardData.serviceId) {
              const billingResult = await setupBilling({
                serviceName: wizardData.serviceName,
                serviceDescription: wizardData.serviceDescription,
                servicePrice: wizardData.servicePrice,
                contractLineName: wizardData.contractLineName,
                serviceTypeId: wizardData.serviceTypeId
              });
              if (!billingResult.success) {
                setErrors(prev => ({ ...prev, [stepIndex]: billingResult.error || 'Failed to setup billing' }));
                return false;
              }
              // Store service ID
              if (billingResult.data?.serviceId) {
                setWizardData(prev => ({ ...prev, serviceId: billingResult.data.serviceId }));
              }
            }
            // If serviceId exists, we've already created this service, just proceed
          }
          break;
      }
      return true;
    } catch (error) {
      setErrors(prev => ({ ...prev, [stepIndex]: error instanceof Error ? error.message : 'Unknown error' }));
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const handleNext = async () => {
    // Mark the current step as attempted
    setAttemptedSteps(prev => new Set([...prev, currentStep]));
    
    if (currentStep < STEPS.length - 1) {
      const saved = await saveStepData(currentStep);
      if (saved) {
        setCompletedSteps(prev => new Set([...prev, currentStep]));
        setCurrentStep(currentStep + 1);
      }
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSkip = () => {
    if (currentStep < STEPS.length - 1 && !REQUIRED_STEPS.includes(currentStep)) {
      // Don't mark as completed when skipping
      setCurrentStep(currentStep + 1);
    }
  };

  const handleStepClick = (stepIndex: number) => {
    // Allow navigation to:
    // 1. First step (always)
    // 2. Any completed step
    // 3. The step immediately after the last completed step
    if (stepIndex === 0 || completedSteps.has(stepIndex) || 
        (stepIndex > 0 && completedSteps.has(stepIndex - 1))) {
      setCurrentStep(stepIndex);
    }
  };

  const handleFinish = async () => {
    if (testMode) {
      console.log('Onboarding completed (test mode):', wizardData);
      onComplete?.(wizardData);
      return;
    }
    
    setIsLoading(true);
    try {
      // Validate we have required defaults before finishing
      if (wizardData.boardName || wizardData.boardId) {
        const validationResult = await validateOnboardingDefaults();
        
        if (!validationResult.success) {
          setErrors(prev => ({ ...prev, [5]: validationResult.error || 'Validation failed' }));
          setIsLoading(false);
          return;
        }
      }
      
      // Save final step (ticketing)
      if (wizardData.boardName || wizardData.boardId) {
        const ticketingResult = await configureTicketing({
          boardName: wizardData.boardName,
          supportEmail: wizardData.supportEmail,
          categories: wizardData.categories,
          priorities: wizardData.priorities,
          ticketPrefix: wizardData.ticketPrefix,
          ticketPaddingLength: wizardData.ticketPaddingLength,
          ticketStartNumber: wizardData.ticketStartNumber,
          boardId: wizardData.boardId,
          statuses: wizardData.statuses
        });
        
        if (!ticketingResult.success) {
          setErrors(prev => ({ ...prev, [5]: ticketingResult.error || 'Failed to configure ticketing' }));
          return;
        }
      }
      
      // Complete onboarding
      const completionResult = await completeOnboarding();
      if (!completionResult.success) {
        setErrors(prev => ({ ...prev, [5]: completionResult.error || 'Failed to complete onboarding' }));
        return;
      }
      
      onComplete?.(wizardData);
      if (!fullPage && onOpenChange) {
        onOpenChange(false);
      }
    } catch (error) {
      console.error('Error completing onboarding:', error);
      setErrors(prev => ({ ...prev, [5]: error instanceof Error ? error.message : 'Unknown error' }));
    } finally {
      setIsLoading(false);
    }
  };

  const isFirstStepValid = () => {
    const { firstName, lastName, clientName, email, newPassword, confirmPassword } = wizardData;

    // For returning users, only validate company name
    if (isRevisit) {
      return !!clientName;
    }

    // For first-time users, validate all fields including password
    // Basic field validation
    if (!firstName || !lastName || !clientName || !email || !newPassword || !confirmPassword) {
      return false;
    }

    // Password validation
    if (newPassword.length < 8) {
      return false;
    }

    if (newPassword !== confirmPassword) {
      return false;
    }

    return true;
  };

  const isTicketingStepValid = () => {
    const { boardName, boardId, priorities } = wizardData;
    // Check if we have either a board name or board ID (from import)
    const hasBoard = (boardName && boardName.trim()) || boardId;
    // Categories are optional, but we need at least one priority
    return !!(hasBoard && priorities.length > 0);
  };

  const hasAtLeastOneFieldFilled = () => {
    switch (currentStep) {
      case 1: // Team members
        return wizardData.teamMembers.some((member) => 
          member.firstName || member.lastName || member.email || member.role
        );
      case 2: // Client
        return !!(wizardData.clientName || wizardData.clientEmail || 
                 wizardData.clientPhone || wizardData.clientUrl);
      case 3: // Contact
        // If we have a clientId (from saved data or previous step), validate normally
        if (wizardData.clientId) {
          return !!(wizardData.contactName || wizardData.contactEmail || wizardData.contactRole);
        }
        // If no clientId, check if client info was provided in the previous step
        const hasClientInfo = !!(wizardData.clientName || wizardData.clientEmail || 
                               wizardData.clientPhone || wizardData.clientUrl);
        if (!hasClientInfo) {
          // If client step was skipped, allow skipping this step too
          return true;
        }
        return !!(wizardData.contactName || wizardData.contactEmail || wizardData.contactRole);
      case 4: // Billing
        return !!(wizardData.serviceTypeId && wizardData.serviceName);
      default:
        return true;
    }
  };

  const isStepValid = () => {
    if (currentStep === 0) return isFirstStepValid();
    if (currentStep === 5) return isTicketingStepValid();
    
    // For optional steps with dependencies, check if the dependency was skipped
    if (currentStep === 3) { // Contact step
      // If client step was skipped (no client data), this step is valid to proceed
      const hasClientInfo = !!(wizardData.clientName || wizardData.clientEmail || 
                             wizardData.clientPhone || wizardData.clientUrl || wizardData.clientId);
      if (!hasClientInfo) return true;
    }
    
    return hasAtLeastOneFieldFilled();
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return <ClientInfoStep data={wizardData} updateData={updateData} isRevisit={isRevisit} />;
      case 1:
        return <TeamMembersStep data={wizardData} updateData={updateData} />;
      case 2:
        return <AddClientStep data={wizardData} updateData={updateData} />;
      case 3:
        return <ClientContactStep data={wizardData} updateData={updateData} />;
      case 4:
        return <BillingSetupStep data={wizardData} updateData={updateData} attemptedToProceed={attemptedSteps.has(4)} />;
      case 5:
        return <TicketingConfigStep data={wizardData} updateData={updateData} />;
      default:
        return null;
    }
  };

  const wizardContent = (
    <>
      <WizardProgress
        steps={STEPS}
        currentStep={currentStep}
        completedSteps={completedSteps}
        onStepClick={handleStepClick}
        canNavigateToStep={(stepIndex) => 
          stepIndex === 0 || 
          stepIndex === currentStep ||  // Current step is always navigable
          completedSteps.has(stepIndex) || 
          (stepIndex > 0 && completedSteps.has(stepIndex - 1))
        }
      />

      <div className="mt-8 mb-4">
        {renderStep()}
      </div>

      {debugMode && (
        <div className="mt-4 p-4 bg-gray-100 rounded text-xs">
          <p className="font-bold mb-2">Debug Info:</p>
          <p>Current Step: {currentStep} ({STEPS[currentStep]})</p>
          <p>Is Valid: {isStepValid() ? 'Yes' : 'No'}</p>
          <p>Is Required: {REQUIRED_STEPS.includes(currentStep) ? 'Yes' : 'No'}</p>
          <details className="mt-2">
            <summary className="cursor-pointer">View Data</summary>
            <pre className="mt-2 text-xs overflow-auto">
              {JSON.stringify(wizardData, null, 2)}
            </pre>
          </details>
        </div>
      )}

      {errors[currentStep] && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-red-700 text-sm">{errors[currentStep]}</p>
        </div>
      )}

      <WizardNavigation
        currentStep={currentStep}
        totalSteps={STEPS.length}
        onBack={handleBack}
        onNext={handleNext}
        onSkip={handleSkip}
        onFinish={handleFinish}
        isNextDisabled={!isStepValid() || isLoading}
        isSkipDisabled={REQUIRED_STEPS.includes(currentStep)}
        isLoading={isLoading}
      />
    </>
  );

  if (fullPage) {
    return (
      <div className="min-h-screen bg-white">
        <div className="mx-auto max-w-5xl px-4 py-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Setup Your System</h1>
            <p className="mt-2 text-lg text-gray-600">Let's get your workspace configured and ready to use.</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            {wizardContent}
          </div>
        </div>
      </div>
    );
  }

  return (
    <Dialog isOpen={open} onClose={() => onOpenChange?.(false)} title="Setup Your System" className="max-w-4xl">
      <div className="max-h-[90vh] overflow-y-auto">
        {wizardContent}
      </div>
    </Dialog>
  );
}