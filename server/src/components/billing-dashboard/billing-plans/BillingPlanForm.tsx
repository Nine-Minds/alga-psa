import React, { useState, useEffect } from 'react';
import { Card, Box } from '@radix-ui/themes';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { PlanTypeSelector, PlanType } from '../plan-types/PlanTypeSelector';
import { IBillingPlan } from 'server/src/interfaces/billing.interfaces';
import { updateBillingPlan } from 'server/src/lib/actions/billingPlanAction';
import { BILLING_FREQUENCY_OPTIONS } from 'server/src/constants/billing';
import { useTenant } from 'server/src/components/TenantProvider';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';

interface BillingPlanFormProps {
  plan: IBillingPlan;
  onPlanUpdated: () => void;
}

const BillingPlanForm: React.FC<BillingPlanFormProps> = ({ plan, onPlanUpdated }) => {
  const [planName, setPlanName] = useState(plan.plan_name || '');
  const [billingFrequency, setBillingFrequency] = useState(plan.billing_frequency || '');
  const [planType, setPlanType] = useState<PlanType>(plan.plan_type as PlanType || 'Fixed');
  const [isCustom, setIsCustom] = useState(plan.is_custom || false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const tenant = useTenant()!;

  useEffect(() => {
    // Update form when plan changes
    setPlanName(plan.plan_name);
    setBillingFrequency(plan.billing_frequency);
    setPlanType(plan.plan_type as PlanType);
    setIsCustom(plan.is_custom);
  }, [plan]);

  const validateForm = (): Record<string, string> => {
    const errors: Record<string, string> = {};

    if (!planName.trim()) {
      errors.planName = 'Plan name is required';
    }

    if (!billingFrequency) {
      errors.billingFrequency = 'Billing frequency is required';
    }

    return errors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate form
    const errors = validateForm();
    setValidationErrors(errors);

    if (Object.keys(errors).length > 0) {
      return;
    }

    if (!plan.plan_id) {
      setError('Cannot update plan: Missing plan ID');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const planData = {
        plan_name: planName,
        billing_frequency: billingFrequency,
        is_custom: isCustom,
        plan_type: planType,
        tenant: tenant
      };

      await updateBillingPlan(plan.plan_id, planData);
      onPlanUpdated();
    } catch (error) {
      console.error('Error updating billing plan:', error);
      setError('Failed to update billing plan');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card size="2">
      <Box p="4">
        <form onSubmit={handleSubmit}>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-4">
            <div>
              <Label htmlFor="plan-name">Plan Name</Label>
              <Input
                id="plan-name"
                type="text"
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
                placeholder="Enter plan name"
                className={validationErrors.planName ? 'border-red-500' : ''}
              />
              {validationErrors.planName && (
                <p className="text-red-500 text-xs mt-1">{validationErrors.planName}</p>
              )}
            </div>

            <div>
              <Label htmlFor="billing-frequency">Billing Frequency</Label>
              <CustomSelect
                id="billing-frequency"
                options={BILLING_FREQUENCY_OPTIONS}
                onValueChange={setBillingFrequency}
                value={billingFrequency}
                placeholder="Select billing frequency"
                className={validationErrors.billingFrequency ? 'border-red-500' : ''}
              />
              {validationErrors.billingFrequency && (
                <p className="text-red-500 text-xs mt-1">{validationErrors.billingFrequency}</p>
              )}
            </div>

            <div>
              <Label>Plan Type</Label>
              <PlanTypeSelector
                value={planType}
                onChange={setPlanType}
                className="w-full"
                showDescriptions={true}
                showCards={true}
              />
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="is-custom"
                checked={isCustom}
                onChange={(e) => setIsCustom(e.target.checked)}
              />
              <Label htmlFor="is-custom" className="cursor-pointer">
                Is Custom Plan
              </Label>
            </div>

            <div className="flex justify-end">
              <Button 
                type="submit" 
                disabled={isSubmitting}
                id="save-plan-details-button"
              >
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </form>
      </Box>
    </Card>
  );
};

export default BillingPlanForm;