// server/src/components/billing-dashboard/HourlyPlanConfiguration.tsx
'use client'

import React, { useState, useEffect, useCallback } from 'react';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Switch } from 'server/src/components/ui/Switch';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle, Loader2, Trash2 } from 'lucide-react';
import { Button } from 'server/src/components/ui/Button';
import { getBillingPlanById, updateBillingPlan } from 'server/src/lib/actions/billingPlanAction'; // Corrected path
import GenericPlanServicesList from './GenericPlanServicesList'; // Import the generic list
import { IBillingPlan } from 'server/src/interfaces/billing.interfaces';

// Define UserTypeRate locally or import if available globally
interface UserTypeRate {
  userType: string;
  rate: number;
}

// Define the expected shape of the plan object returned by getBillingPlanById for Hourly
type HourlyPlanData = IBillingPlan & {
    hourly_rate?: number;
    minimum_billable_time?: number;
    round_up_to_nearest?: number;
    enable_overtime?: boolean;
    overtime_rate?: number;
    overtime_threshold?: number;
    enable_after_hours_rate?: boolean;
    after_hours_multiplier?: number;
    user_type_rates?: UserTypeRate[];
};

interface HourlyPlanConfigurationProps {
  planId: string;
  className?: string;
}

export function HourlyPlanConfiguration({
  planId,
  className = '',
}: HourlyPlanConfigurationProps) {
  const [plan, setPlan] = useState<HourlyPlanData | null>(null);
  const [hourlyRate, setHourlyRate] = useState<number | undefined>(undefined);
  const [minimumBillableTime, setMinimumBillableTime] = useState<number | undefined>(15);
  const [roundUpToNearest, setRoundUpToNearest] = useState<number | undefined>(15);
  const [enableOvertime, setEnableOvertime] = useState<boolean>(false);
  const [overtimeRate, setOvertimeRate] = useState<number | undefined>(undefined);
  const [overtimeThreshold, setOvertimeThreshold] = useState<number | undefined>(40);
  const [enableAfterHoursRate, setEnableAfterHoursRate] = useState<boolean>(false);
  const [afterHoursMultiplier, setAfterHoursMultiplier] = useState<number | undefined>(1.5);
  const [userTypeRates, setUserTypeRates] = useState<UserTypeRate[]>([]);

  const [newUserType, setNewUserType] = useState('');
  const [newUserTypeRate, setNewUserTypeRate] = useState<number | undefined>(undefined);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<{
    hourlyRate?: string;
    minimumBillableTime?: string;
    roundUpToNearest?: string;
    overtimeRate?: string;
    overtimeThreshold?: string;
    afterHoursMultiplier?: string;
    newUserTypeRate?: string;
  }>({});

  const fetchPlanData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fetchedPlan = await getBillingPlanById(planId) as HourlyPlanData; // Cast to expected type
      if (fetchedPlan && fetchedPlan.plan_type === 'Hourly') { // Match enum case
        setPlan(fetchedPlan);
        // Assume config fields are returned directly on the plan object
        setHourlyRate(fetchedPlan.hourly_rate);
        setMinimumBillableTime(fetchedPlan.minimum_billable_time ?? 15);
        setRoundUpToNearest(fetchedPlan.round_up_to_nearest ?? 15);
        setEnableOvertime(fetchedPlan.enable_overtime ?? false);
        setOvertimeRate(fetchedPlan.overtime_rate);
        setOvertimeThreshold(fetchedPlan.overtime_threshold ?? 40);
        setEnableAfterHoursRate(fetchedPlan.enable_after_hours_rate ?? false);
        setAfterHoursMultiplier(fetchedPlan.after_hours_multiplier ?? 1.5);
        setUserTypeRates(fetchedPlan.user_type_rates || []);
      } else {
        setError('Invalid plan type or plan not found.');
      }
    } catch (err) {
      console.error('Error fetching plan data:', err);
      setError('Failed to load plan configuration. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    fetchPlanData();
  }, [fetchPlanData]);

  // Validate inputs
  useEffect(() => {
    const errors: typeof validationErrors = {};
    if (hourlyRate !== undefined && hourlyRate < 0) errors.hourlyRate = 'Hourly rate cannot be negative';
    if (minimumBillableTime !== undefined && minimumBillableTime < 0) errors.minimumBillableTime = 'Minimum billable time cannot be negative';
    if (roundUpToNearest !== undefined && roundUpToNearest < 0) errors.roundUpToNearest = 'Round up value cannot be negative';
    if (enableOvertime && overtimeRate !== undefined && overtimeRate < 0) errors.overtimeRate = 'Overtime rate cannot be negative';
    if (enableOvertime && overtimeThreshold !== undefined && overtimeThreshold < 0) errors.overtimeThreshold = 'Overtime threshold cannot be negative';
    if (enableAfterHoursRate && afterHoursMultiplier !== undefined && afterHoursMultiplier < 1) errors.afterHoursMultiplier = 'After hours multiplier must be at least 1';
    if (newUserTypeRate !== undefined && newUserTypeRate < 0) errors.newUserTypeRate = 'User type rate cannot be negative';
    setValidationErrors(errors);
  }, [hourlyRate, minimumBillableTime, roundUpToNearest, enableOvertime, overtimeRate, overtimeThreshold, enableAfterHoursRate, afterHoursMultiplier, newUserTypeRate]);

  const handleSave = async () => {
    if (!plan || Object.values(validationErrors).some(e => e)) {
        setSaveError("Cannot save, validation errors exist or plan not loaded.");
        return;
    }
    setSaving(true);
    setSaveError(null);
    try {
        // Construct payload with correct field names expected by updateBillingPlan
        const updatePayload: Partial<HourlyPlanData> = {
            hourly_rate: hourlyRate,
            minimum_billable_time: minimumBillableTime,
            round_up_to_nearest: roundUpToNearest,
            enable_overtime: enableOvertime,
            overtime_rate: enableOvertime ? overtimeRate : undefined,
            overtime_threshold: enableOvertime ? overtimeThreshold : undefined,
            enable_after_hours_rate: enableAfterHoursRate,
            after_hours_multiplier: enableAfterHoursRate ? afterHoursMultiplier : undefined,
            user_type_rates: userTypeRates,
        };
        await updateBillingPlan(planId, updatePayload); // Pass payload directly
        // Optionally re-fetch or show success
    } catch (err) {
        console.error('Error saving plan configuration:', err);
        setSaveError('Failed to save configuration. Please try again.');
    } finally {
        setSaving(false);
    }
  };

  const handleAddUserTypeRate = () => {
    if (!newUserType || newUserTypeRate === undefined || newUserTypeRate < 0) return;
    const updatedRates = [...userTypeRates, { userType: newUserType, rate: newUserTypeRate }];
    setUserTypeRates(updatedRates);
    setNewUserType('');
    setNewUserTypeRate(undefined);
  };

  const handleRemoveUserTypeRate = (index: number) => {
    const updatedRates = [...userTypeRates];
    updatedRates.splice(index, 1);
    setUserTypeRates(updatedRates);
  };

  // Simplified number input handler
  const handleNumberInputChange = (setter: React.Dispatch<React.SetStateAction<number | undefined>>) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value === '' ? undefined : Number(e.target.value);
      setter(value);
  };

  const userTypeOptions = [
    { value: 'technician', label: 'Technician' },
    { value: 'engineer', label: 'Engineer' },
    { value: 'consultant', label: 'Consultant' },
    { value: 'project_manager', label: 'Project Manager' },
    { value: 'admin', label: 'Administrator' }
    // Add other relevant user types
  ];

  if (loading && !plan) {
    return <div className="flex justify-center items-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  if (error) {
    return (
      <Alert variant="destructive" className={`m-4 ${className}`}>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

   if (!plan) {
      return <div className="p-4">Plan not found or invalid type.</div>;
  }

  return (
    <div className={`space-y-6 ${className}`}>
      <Card>
        <CardHeader>
          <CardTitle>Hourly Plan Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {saveError && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          )}

          {/* Basic Hourly Settings */}
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label htmlFor="hourly-plan-rate">Default Hourly Rate</Label>
              <Input
                id="hourly-plan-rate" type="number"
                value={hourlyRate?.toString() || ''}
                onChange={handleNumberInputChange(setHourlyRate)}
                placeholder="Enter hourly rate" disabled={saving} min={0} step={0.01}
                className={validationErrors.hourlyRate ? 'border-red-500' : ''}
              />
              {validationErrors.hourlyRate && <p className="text-sm text-red-500 mt-1">{validationErrors.hourlyRate}</p>}
              {!validationErrors.hourlyRate && <p className="text-sm text-muted-foreground mt-1">Standard rate per hour.</p>}
            </div>
            <div>
              <Label htmlFor="minimum-billable-time">Min Billable Time (min)</Label>
              <Input
                id="minimum-billable-time" type="number"
                value={minimumBillableTime?.toString() || ''}
                onChange={handleNumberInputChange(setMinimumBillableTime)}
                placeholder="15" disabled={saving} min={0} step={1}
                className={validationErrors.minimumBillableTime ? 'border-red-500' : ''}
              />
              {validationErrors.minimumBillableTime && <p className="text-sm text-red-500 mt-1">{validationErrors.minimumBillableTime}</p>}
              {!validationErrors.minimumBillableTime && <p className="text-sm text-muted-foreground mt-1">Minimum time billed.</p>}
            </div>
            <div>
              <Label htmlFor="round-up-to-nearest">Round Up To (min)</Label>
              <Input
                id="round-up-to-nearest" type="number"
                value={roundUpToNearest?.toString() || ''}
                onChange={handleNumberInputChange(setRoundUpToNearest)}
                placeholder="15" disabled={saving} min={0} step={1}
                className={validationErrors.roundUpToNearest ? 'border-red-500' : ''}
              />
              {validationErrors.roundUpToNearest && <p className="text-sm text-red-500 mt-1">{validationErrors.roundUpToNearest}</p>}
              {!validationErrors.roundUpToNearest && <p className="text-sm text-muted-foreground mt-1">Round time up to nearest.</p>}
            </div>
          </div>

          {/* User Type Rates */}
          <Card className="bg-muted/40">
            <CardHeader><CardTitle className="text-base">User Type Specific Rates</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {userTypeRates.length > 0 && (
                <div className="space-y-2">
                  {userTypeRates.map((item, index) => (
                    <div key={index} className="flex items-center justify-between gap-2 p-2 border rounded">
                      <span className="font-medium">{userTypeOptions.find(opt => opt.value === item.userType)?.label || item.userType}</span>
                      <span>${item.rate.toFixed(2)}/hr</span>
                      <Button id={`remove-user-type-rate-${index}`} variant="ghost" size="sm" onClick={() => handleRemoveUserTypeRate(index)} disabled={saving}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-end gap-2 pt-2">
                <div className="flex-1 min-w-[150px]">
                  <Label htmlFor="new-user-type">User Type</Label>
                  <CustomSelect
                    id="new-user-type" options={userTypeOptions}
                    onValueChange={setNewUserType} value={newUserType}
                    placeholder="Select type" disabled={saving}
                  />
                </div>
                <div className="flex-1 min-w-[100px]">
                  <Label htmlFor="new-user-type-rate">Rate</Label>
                  <Input
                    id="new-user-type-rate" type="number"
                    value={newUserTypeRate?.toString() || ''}
                    onChange={handleNumberInputChange(setNewUserTypeRate)}
                    placeholder="Rate" disabled={saving} min={0} step={0.01}
                    className={validationErrors.newUserTypeRate ? 'border-red-500' : ''}
                  />
                   {validationErrors.newUserTypeRate && <p className="text-sm text-red-500 mt-1">{validationErrors.newUserTypeRate}</p>}
                </div>
                <Button
                  id="add-user-type-rate-button" // Added ID
                  type="button" onClick={handleAddUserTypeRate}
                  disabled={saving || !newUserType || newUserTypeRate === undefined || newUserTypeRate < 0}
                  className="mt-auto" // Align button with inputs
                >
                  Add Rate
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Overtime */}
          <div className="space-y-3 pt-3">
            <div className="flex items-center space-x-2">
              <Switch id="enable-overtime" checked={enableOvertime} onCheckedChange={setEnableOvertime} disabled={saving} />
              <Label htmlFor="enable-overtime" className="cursor-pointer">Enable Overtime Rates</Label>
            </div>
            {enableOvertime && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-8">
                <div>
                  <Label htmlFor="overtime-rate">Overtime Rate</Label>
                  <Input
                    id="overtime-rate" type="number"
                    value={overtimeRate?.toString() || ''}
                    onChange={handleNumberInputChange(setOvertimeRate)}
                    placeholder="Enter overtime rate" disabled={saving} min={0} step={0.01}
                    className={validationErrors.overtimeRate ? 'border-red-500' : ''}
                  />
                  {validationErrors.overtimeRate && <p className="text-sm text-red-500 mt-1">{validationErrors.overtimeRate}</p>}
                  {!validationErrors.overtimeRate && <p className="text-sm text-muted-foreground mt-1">Rate after threshold.</p>}
                </div>
                <div>
                  <Label htmlFor="overtime-threshold">Overtime Threshold (hrs/period)</Label>
                  <Input
                    id="overtime-threshold" type="number"
                    value={overtimeThreshold?.toString() || ''}
                    onChange={handleNumberInputChange(setOvertimeThreshold)}
                    placeholder="40" disabled={saving} min={0} step={1}
                    className={validationErrors.overtimeThreshold ? 'border-red-500' : ''}
                  />
                  {validationErrors.overtimeThreshold && <p className="text-sm text-red-500 mt-1">{validationErrors.overtimeThreshold}</p>}
                  {!validationErrors.overtimeThreshold && <p className="text-sm text-muted-foreground mt-1">Hours before OT applies.</p>}
                </div>
              </div>
            )}
          </div>

          {/* After Hours */}
          <div className="space-y-3 pt-3">
            <div className="flex items-center space-x-2">
              <Switch id="enable-after-hours" checked={enableAfterHoursRate} onCheckedChange={setEnableAfterHoursRate} disabled={saving} />
              <Label htmlFor="enable-after-hours" className="cursor-pointer">Enable After-Hours Rate Multiplier</Label>
            </div>
            {enableAfterHoursRate && (
              <div className="pl-8">
                <Label htmlFor="after-hours-multiplier">After-Hours Multiplier</Label>
                <Input
                  id="after-hours-multiplier" type="number"
                  value={afterHoursMultiplier?.toString() || ''}
                  onChange={handleNumberInputChange(setAfterHoursMultiplier)}
                  placeholder="1.5" disabled={saving} min={1} step={0.1}
                  className={`w-full md:w-1/2 ${validationErrors.afterHoursMultiplier ? 'border-red-500' : ''}`}
                />
                {validationErrors.afterHoursMultiplier && <p className="text-sm text-red-500 mt-1">{validationErrors.afterHoursMultiplier}</p>}
                {!validationErrors.afterHoursMultiplier && <p className="text-sm text-muted-foreground mt-1">Multiplier for non-business hours (e.g., 1.5x).</p>}
              </div>
            )}
          </div>

          {/* Save Button */}
          <div className="flex justify-end pt-4">
            <Button id="save-hourly-config-button" onClick={handleSave} disabled={saving || Object.values(validationErrors).some(e => e)}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Configuration
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Placeholder for Services List */}
      <Card>
          <CardHeader>
              <CardTitle>Applicable Services</CardTitle>
          </CardHeader>
          <CardContent>
              <GenericPlanServicesList planId={planId} />
          </CardContent>
      </Card>
    </div>
  );
}