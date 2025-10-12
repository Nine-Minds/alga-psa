'use client';

import React, { useState, useEffect } from 'react';
import { Dialog } from 'server/src/components/ui/Dialog';
import { WizardProgress } from 'server/src/components/onboarding/WizardProgress';
import { WizardNavigation } from 'server/src/components/onboarding/WizardNavigation';
import { ContractBasicsStep } from './wizard-steps/ContractBasicsStep';
import { FixedFeeServicesStep } from './wizard-steps/FixedFeeServicesStep';
import { HourlyServicesStep } from './wizard-steps/HourlyServicesStep';
import { BucketHoursStep } from './wizard-steps/BucketHoursStep';
import { UsageBasedServicesStep } from './wizard-steps/UsageBasedServicesStep';
import { ReviewContractStep } from './wizard-steps/ReviewContractStep';
import { createContractFromWizard } from 'server/src/lib/actions/contractWizardActions';

const STEPS = [
  'Contract Basics',
  'Fixed Fee Services',
  'Hourly Services',
  'Usage-Based Services',
  'Bucket Services',
  'Review & Create'
];

const REQUIRED_STEPS = [0, 5]; // Contract Basics and Review are required

export interface ContractWizardData {
  // Step 1: Contract Basics
  company_id: string;
  client_id?: string;
  contract_name: string;
  start_date: string;
  end_date?: string;
  description?: string;
  billing_frequency: string;

  // Purchase Order fields
  po_number?: string;
  po_amount?: number;
  po_required?: boolean;

  // Step 2: Fixed Fee Services
  fixed_services: Array<{
    service_id: string;
    service_name?: string;
    quantity: number;
  }>;
  fixed_base_rate?: number;
  enable_proration: boolean;

  // Step 3: Hourly Services
  hourly_services: Array<{
    service_id: string;
    service_name?: string;
    hourly_rate?: number;
  }>;
  minimum_billable_time?: number;
  round_up_to_nearest?: number;

  // Step 4/5: Bucket Services configuration
  bucket_type?: 'hours' | 'usage';
  bucket_hours?: number;
  bucket_usage_units?: number;
  bucket_unit_of_measure?: string;
  bucket_monthly_fee?: number;
  bucket_overage_rate?: number;
  bucket_services: Array<{
    service_id: string;
    service_name?: string;
  }>;

  // Step 4: Usage-Based Services
  usage_services?: Array<{
    service_id: string;
    service_name?: string;
    unit_rate?: number;
    unit_of_measure?: string;
  }>;

  // Internal tracking
  bundle_id?: string; // Set after creation
  is_draft?: boolean;
}

interface ContractWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: (data: ContractWizardData) => void;
  editingContract?: ContractWizardData | null;
}

export function ContractWizard({
  open,
  onOpenChange,
  onComplete,
  editingContract = null
}: ContractWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  const [wizardData, setWizardData] = useState<ContractWizardData>({
    company_id: '',
    client_id: '',
    contract_name: '',
    start_date: '',
    end_date: undefined,
    description: '',
    billing_frequency: 'monthly',
    fixed_services: [],
    fixed_base_rate: undefined,
    enable_proration: true,
    hourly_services: [],
    minimum_billable_time: undefined,
    round_up_to_nearest: undefined,
    bucket_type: undefined,
    bucket_hours: undefined,
    bucket_usage_units: undefined,
    bucket_unit_of_measure: undefined,
    bucket_monthly_fee: undefined,
    bucket_overage_rate: undefined,
    bucket_services: [],
    usage_services: [],
    ...editingContract
  });

  useEffect(() => {
    if (editingContract) {
      setWizardData({ ...wizardData, ...editingContract });
    }
  }, [editingContract]);

  const updateData = (data: Partial<ContractWizardData>) => {
    setWizardData((prev) => {
      const next = { ...prev, ...data };

      if ('client_id' in data && !('company_id' in data)) {
        next.company_id = data.client_id ?? '';
      }

      if ('company_id' in data && !('client_id' in data)) {
        next.client_id = data.company_id ?? '';
      }

      return next;
    });
  };

  const validateStep = (stepIndex: number): boolean => {
    setErrors(prev => ({ ...prev, [stepIndex]: '' }));

    switch (stepIndex) {
      case 0: // Contract Basics
        if (!(wizardData.client_id || wizardData.company_id)) {
          setErrors(prev => ({ ...prev, [stepIndex]: 'Client is required' }));
          return false;
        }
        if (!wizardData.contract_name?.trim()) {
          setErrors(prev => ({ ...prev, [stepIndex]: 'Contract name is required' }));
          return false;
        }
        if (!wizardData.billing_frequency) {
          setErrors(prev => ({ ...prev, [stepIndex]: 'Billing frequency is required' }));
          return false;
        }
        if (!wizardData.start_date) {
          setErrors(prev => ({ ...prev, [stepIndex]: 'Start date is required' }));
          return false;
        }
        return true;

      case 1: // Fixed Fee Services
        // Optional step - validate only if user has added services
        if (wizardData.fixed_services.length > 0 && !wizardData.fixed_base_rate) {
          setErrors(prev => ({ ...prev, [stepIndex]: 'Base rate is required when services are selected' }));
          return false;
        }
        return true;

      case 2: // Hourly Services
        // Optional step
        return true;

      case 3: // Usage-Based Services
        // Optional step
        return true;

      case 4: // Bucket Services
        // Optional step - validate only if user has filled any bucket field
        const hasBucketData =
          wizardData.bucket_type || wizardData.bucket_monthly_fee || wizardData.bucket_overage_rate;

        if (hasBucketData) {
          if (!wizardData.bucket_type) {
            setErrors(prev => ({ ...prev, [stepIndex]: 'Bucket type is required' }));
            return false;
          }

          if (wizardData.bucket_type === 'hours' && !wizardData.bucket_hours) {
            setErrors(prev => ({ ...prev, [stepIndex]: 'Bucket hours are required for hours-based buckets' }));
            return false;
          }

          if (wizardData.bucket_type === 'usage') {
            if (!wizardData.bucket_usage_units) {
              setErrors(prev => ({ ...prev, [stepIndex]: 'Usage units are required for usage-based buckets' }));
              return false;
            }
            if (!wizardData.bucket_unit_of_measure) {
              setErrors(prev => ({ ...prev, [stepIndex]: 'Unit of measure is required for usage-based buckets' }));
              return false;
            }
          }

          if (!wizardData.bucket_monthly_fee) {
            setErrors(prev => ({ ...prev, [stepIndex]: 'Monthly fee is required' }));
            return false;
          }

          if (!wizardData.bucket_overage_rate) {
            setErrors(prev => ({ ...prev, [stepIndex]: 'Overage rate is required' }));
            return false;
          }
        }
        return true;

      case 5: // Review
        // Check that at least one service type is configured
        const hasServices =
          wizardData.fixed_services.length > 0 ||
          wizardData.hourly_services.length > 0 ||
          ((wizardData.bucket_type === 'hours' && wizardData.bucket_hours) ||
            (wizardData.bucket_type === 'usage' && wizardData.bucket_usage_units)) &&
            wizardData.bucket_services.length > 0 ||
          (wizardData.usage_services && wizardData.usage_services.length > 0);

        if (!hasServices) {
          setErrors(prev => ({ ...prev, [stepIndex]: 'At least one service line is required' }));
          return false;
        }
        return true;

      default:
        return true;
    }
  };

  const handleNext = async () => {
    if (!validateStep(currentStep)) {
      return;
    }

    if (currentStep < STEPS.length - 1) {
      setCompletedSteps(prev => new Set([...prev, currentStep]));
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
    // Allow navigation to completed steps or the next step after last completed
    if (stepIndex === 0 || completedSteps.has(stepIndex) ||
        (stepIndex > 0 && completedSteps.has(stepIndex - 1))) {
      setCurrentStep(stepIndex);
    }
  };

  const handleFinish = async () => {
    if (!validateStep(currentStep)) {
      return;
    }

    setIsLoading(true);
    try {
      const bundleName = wizardData.contract_name.trim();
      const bundleDescription = wizardData.description?.trim();

      const contractResult = await createContractFromWizard({
        contract_name: bundleName,
        description: bundleDescription || undefined,
        company_id: wizardData.company_id,
        start_date: wizardData.start_date,
        end_date: wizardData.end_date,
        po_required: wizardData.po_required,
        po_number: wizardData.po_number,
        po_amount: wizardData.po_amount,
        fixed_base_rate: wizardData.fixed_base_rate,
        enable_proration: wizardData.enable_proration,
        fixed_services: wizardData.fixed_services,
        hourly_services: wizardData.hourly_services,
        minimum_billable_time: wizardData.minimum_billable_time,
        round_up_to_nearest: wizardData.round_up_to_nearest,
        // Bucket fields
        bucket_type: wizardData.bucket_type,
        bucket_hours: wizardData.bucket_hours,
        bucket_usage_units: wizardData.bucket_usage_units,
        bucket_unit_of_measure: wizardData.bucket_unit_of_measure,
        bucket_monthly_fee: wizardData.bucket_monthly_fee,
        bucket_overage_rate: wizardData.bucket_overage_rate,
        bucket_services: wizardData.bucket_services,
      });

      const completedData: ContractWizardData = {
        ...wizardData,
        bundle_id: contractResult.bundle_id,
      };

      setWizardData(completedData);
      console.log('Creating contract with data:', completedData);
      onComplete?.(completedData);
      onOpenChange(false);
    } catch (error) {
      console.error('Error creating contract:', error);
      setErrors(prev => ({
        ...prev,
        [currentStep]: error instanceof Error ? error.message : 'Failed to create contract'
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!(wizardData.client_id || wizardData.company_id)) {
      setErrors(prev => ({ ...prev, [currentStep]: 'Select a client before saving as draft' }));
      return;
    }

    setIsLoading(true);
    try {
      const clientIdentifier = wizardData.client_id || wizardData.company_id;
      onComplete?.({
        ...wizardData,
        company_id: clientIdentifier ?? '',
        client_id: clientIdentifier,
        is_draft: true
      });
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving contract draft:', error);
      setErrors(prev => ({
        ...prev,
        [currentStep]: error instanceof Error ? error.message : 'Failed to save draft'
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return <ContractBasicsStep data={wizardData} updateData={updateData} />;
      case 1:
        return <FixedFeeServicesStep data={wizardData} updateData={updateData} />;
      case 2:
        return <HourlyServicesStep data={wizardData} updateData={updateData} />;
      case 3:
        return <UsageBasedServicesStep data={wizardData} updateData={updateData} />;
      case 4:
        return <BucketHoursStep data={wizardData} updateData={updateData} />;
      case 5:
        return <ReviewContractStep data={wizardData} />;
      default:
        return null;
    }
  };

  return (
    <Dialog
      isOpen={open}
      onClose={() => onOpenChange(false)}
      title={editingContract ? "Edit Contract" : "Create New Contract"}
      className="max-w-4xl max-h-[90vh]"
    >
      <div className="flex flex-col h-full">
        <div className="flex-shrink-0 px-6 pt-6">
          <WizardProgress
            steps={STEPS}
            currentStep={currentStep}
            completedSteps={completedSteps}
            onStepClick={handleStepClick}
            canNavigateToStep={(stepIndex) =>
              stepIndex === 0 ||
              stepIndex === currentStep ||
              completedSteps.has(stepIndex) ||
              (stepIndex > 0 && completedSteps.has(stepIndex - 1))
            }
          />
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mb-4">
            {renderStep()}
          </div>

          {errors[currentStep] && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-red-700 text-sm">{errors[currentStep]}</p>
            </div>
          )}
        </div>

        <div className="flex-shrink-0 px-6 pb-6 border-t bg-white">
          <WizardNavigation
            currentStep={currentStep}
            totalSteps={STEPS.length}
            onBack={handleBack}
            onNext={handleNext}
            onSkip={handleSkip}
            onFinish={handleFinish}
            onSaveDraft={handleSaveDraft}
            isNextDisabled={isLoading}
            isSkipDisabled={REQUIRED_STEPS.includes(currentStep)}
            isLoading={isLoading}
            showSaveDraft
          />
        </div>
      </div>
    </Dialog>
  );
}
