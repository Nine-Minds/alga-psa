'use client';

import React, { useState, useEffect } from 'react';
import { Dialog } from 'server/src/components/ui/Dialog';
import { WizardProgress } from './WizardProgress';
import { WizardNavigation } from './WizardNavigation';
import { CompanyInfoStep } from './steps/CompanyInfoStep';
import { TeamMembersStep } from './steps/TeamMembersStep';
import { AddClientStep } from './steps/AddClientStep';
import { ClientContactStep } from './steps/ClientContactStep';
import { BillingSetupStep } from './steps/BillingSetupStep';
import { TicketingConfigStep } from './steps/TicketingConfigStep';
import { WizardData, STEPS, REQUIRED_STEPS } from './types';

interface OnboardingWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testMode?: boolean;
  debugMode?: boolean;
  initialData?: Partial<WizardData>;
  onComplete?: (data: WizardData) => void;
}

export function OnboardingWizard({
  open,
  onOpenChange,
  testMode = false,
  debugMode = false,
  initialData = {},
  onComplete,
}: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [wizardData, setWizardData] = useState<WizardData>({
    // Company Info
    firstName: '',
    lastName: '',
    companyName: '',
    email: '',

    // Team Members
    teamMembers: [{ firstName: '', lastName: '', email: '', role: 'Technician' }],

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
    planName: 'monthly',

    // Ticketing
    channelName: '',
    supportEmail: '',
    categories: ['Technical Support', 'Network Issue', 'Software Issue'],
    priorities: ['Low', 'Medium', 'High', 'Critical'],
    
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

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSkip = () => {
    if (currentStep < STEPS.length - 1 && !REQUIRED_STEPS.includes(currentStep)) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleStepClick = (stepIndex: number) => {
    if (stepIndex === 0 || isFirstStepValid()) {
      setCurrentStep(stepIndex);
    }
  };

  const handleFinish = () => {
    if (testMode) {
      console.log('Onboarding completed (test mode):', wizardData);
    }
    onComplete?.(wizardData);
    if (!testMode) {
      onOpenChange(false);
    }
  };

  const isFirstStepValid = () => {
    const { firstName, lastName, companyName, email } = wizardData;
    return !!(firstName && lastName && companyName && email);
  };

  const isTicketingStepValid = () => {
    const { channelName, categories, priorities } = wizardData;
    return !!(channelName && channelName.trim() && categories.length > 0 && priorities.length > 0);
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
        const hasClientInfo = !!(wizardData.clientName || wizardData.clientEmail || 
                               wizardData.clientPhone || wizardData.clientUrl);
        if (!hasClientInfo) return false;
        return !!(wizardData.contactName || wizardData.contactEmail || wizardData.contactRole);
      case 4: // Billing
        return !!(wizardData.serviceName || wizardData.serviceDescription || 
                 wizardData.servicePrice || wizardData.planName);
      default:
        return true;
    }
  };

  const isStepValid = () => {
    if (currentStep === 0) return isFirstStepValid();
    if (currentStep === 5) return isTicketingStepValid();
    return hasAtLeastOneFieldFilled();
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return <CompanyInfoStep data={wizardData} updateData={updateData} />;
      case 1:
        return <TeamMembersStep data={wizardData} updateData={updateData} />;
      case 2:
        return <AddClientStep data={wizardData} updateData={updateData} />;
      case 3:
        return <ClientContactStep data={wizardData} updateData={updateData} />;
      case 4:
        return <BillingSetupStep data={wizardData} updateData={updateData} />;
      case 5:
        return <TicketingConfigStep data={wizardData} updateData={updateData} />;
      default:
        return null;
    }
  };

  return (
    <Dialog isOpen={open} onClose={() => onOpenChange(false)} title="Setup Your System" className="max-w-4xl">
        <div className="max-h-[90vh] overflow-y-auto">
          <WizardProgress
            steps={STEPS}
            currentStep={currentStep}
            onStepClick={handleStepClick}
            canNavigateToStep={(stepIndex) => stepIndex === 0 || isFirstStepValid()}
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

          <WizardNavigation
            currentStep={currentStep}
            totalSteps={STEPS.length}
            onBack={handleBack}
            onNext={handleNext}
            onSkip={handleSkip}
            onFinish={handleFinish}
            isNextDisabled={!isStepValid()}
            isSkipDisabled={REQUIRED_STEPS.includes(currentStep)}
          />
        </div>
    </Dialog>
  );
}