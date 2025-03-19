'use client'

import React, { useState, useEffect } from 'react';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Card } from 'server/src/components/ui/Card';
import { Switch } from 'server/src/components/ui/Switch';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Button } from 'server/src/components/ui/Button';
import { IPlanServiceHourlyConfig, IUserTypeRate } from 'server/src/interfaces/planServiceConfiguration.interfaces';
import { Trash2 } from 'lucide-react';

interface HourlyServiceConfigPanelProps {
  configuration: Partial<IPlanServiceHourlyConfig>;
  userTypeRates?: IUserTypeRate[];
  onConfigurationChange: (updates: Partial<IPlanServiceHourlyConfig>) => void;
  onUserTypeRatesChange?: (rates: IUserTypeRate[]) => void;
  className?: string;
  disabled?: boolean;
}

export function HourlyServiceConfigPanel({
  configuration,
  userTypeRates = [],
  onConfigurationChange,
  onUserTypeRatesChange,
  className = '',
  disabled = false
}: HourlyServiceConfigPanelProps) {
  const [minimumBillableTime, setMinimumBillableTime] = useState(configuration.minimum_billable_time || 15);
  const [roundUpToNearest, setRoundUpToNearest] = useState(configuration.round_up_to_nearest || 15);
  const [enableOvertime, setEnableOvertime] = useState(configuration.enable_overtime || false);
  const [overtimeRate, setOvertimeRate] = useState<number | undefined>(configuration.overtime_rate);
  const [overtimeThreshold, setOvertimeThreshold] = useState<number | undefined>(configuration.overtime_threshold || 40);
  const [enableAfterHoursRate, setEnableAfterHoursRate] = useState(configuration.enable_after_hours_rate || false);
  const [afterHoursMultiplier, setAfterHoursMultiplier] = useState<number | undefined>(
    configuration.after_hours_multiplier || 1.5
  );
  const [newUserType, setNewUserType] = useState('');
  const [newUserTypeRate, setNewUserTypeRate] = useState<number | undefined>(undefined);
  const [validationErrors, setValidationErrors] = useState<{
    minimumBillableTime?: string;
    roundUpToNearest?: string;
    overtimeRate?: string;
    overtimeThreshold?: string;
    afterHoursMultiplier?: string;
    newUserTypeRate?: string;
  }>({});

  // Update local state when props change
  useEffect(() => {
    setMinimumBillableTime(configuration.minimum_billable_time || 15);
    setRoundUpToNearest(configuration.round_up_to_nearest || 15);
    setEnableOvertime(configuration.enable_overtime || false);
    setOvertimeRate(configuration.overtime_rate);
    setOvertimeThreshold(configuration.overtime_threshold || 40);
    setEnableAfterHoursRate(configuration.enable_after_hours_rate || false);
    setAfterHoursMultiplier(configuration.after_hours_multiplier || 1.5);
  }, [configuration]);

  // Validate inputs when they change
  useEffect(() => {
    const errors: {
      minimumBillableTime?: string;
      roundUpToNearest?: string;
      overtimeRate?: string;
      overtimeThreshold?: string;
      afterHoursMultiplier?: string;
      newUserTypeRate?: string;
    } = {};

    if (minimumBillableTime < 0) {
      errors.minimumBillableTime = 'Minimum billable time cannot be negative';
    }

    if (roundUpToNearest < 0) {
      errors.roundUpToNearest = 'Round up value cannot be negative';
    }

    if (enableOvertime && overtimeRate !== undefined && overtimeRate < 0) {
      errors.overtimeRate = 'Overtime rate cannot be negative';
    }

    if (enableOvertime && overtimeThreshold !== undefined && overtimeThreshold < 0) {
      errors.overtimeThreshold = 'Overtime threshold cannot be negative';
    }

    if (enableAfterHoursRate && afterHoursMultiplier !== undefined && afterHoursMultiplier < 1) {
      errors.afterHoursMultiplier = 'After hours multiplier must be at least 1';
    }

    if (newUserTypeRate !== undefined && newUserTypeRate < 0) {
      errors.newUserTypeRate = 'User type rate cannot be negative';
    }

    setValidationErrors(errors);
  }, [
    minimumBillableTime,
    roundUpToNearest,
    enableOvertime,
    overtimeRate,
    overtimeThreshold,
    enableAfterHoursRate,
    afterHoursMultiplier,
    newUserTypeRate
  ]);

  const handleMinimumBillableTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    setMinimumBillableTime(value);
    onConfigurationChange({ minimum_billable_time: value });
  };

  const handleRoundUpToNearestChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    setRoundUpToNearest(value);
    onConfigurationChange({ round_up_to_nearest: value });
  };

  const handleEnableOvertimeChange = (checked: boolean) => {
    setEnableOvertime(checked);
    onConfigurationChange({ enable_overtime: checked });
  };

  const handleOvertimeRateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value === '' ? undefined : Number(e.target.value);
    setOvertimeRate(value);
    onConfigurationChange({ overtime_rate: value });
  };

  const handleOvertimeThresholdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value === '' ? undefined : Number(e.target.value);
    setOvertimeThreshold(value);
    onConfigurationChange({ overtime_threshold: value });
  };

  const handleEnableAfterHoursRateChange = (checked: boolean) => {
    setEnableAfterHoursRate(checked);
    onConfigurationChange({ enable_after_hours_rate: checked });
  };

  const handleAfterHoursMultiplierChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value === '' ? undefined : Number(e.target.value);
    setAfterHoursMultiplier(value);
    onConfigurationChange({ after_hours_multiplier: value });
  };

  const handleNewUserTypeRateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value === '' ? undefined : Number(e.target.value);
    setNewUserTypeRate(value);
  };

  const handleAddUserTypeRate = () => {
    if (!onUserTypeRatesChange || !newUserType || newUserTypeRate === undefined || newUserTypeRate < 0) {
      return;
    }

    const newRate: Partial<IUserTypeRate> = {
      user_type: newUserType,
      rate: newUserTypeRate
    };

    onUserTypeRatesChange([...userTypeRates, newRate as IUserTypeRate]);
    setNewUserType('');
    setNewUserTypeRate(undefined);
  };

  const handleRemoveUserTypeRate = (index: number) => {
    if (!onUserTypeRatesChange) return;
    const updatedRates = [...userTypeRates];
    updatedRates.splice(index, 1);
    onUserTypeRatesChange(updatedRates);
  };

  const userTypeOptions = [
    { value: 'technician', label: 'Technician' },
    { value: 'engineer', label: 'Engineer' },
    { value: 'consultant', label: 'Consultant' },
    { value: 'project_manager', label: 'Project Manager' },
    { value: 'admin', label: 'Administrator' }
  ];

  return (
    <Card className={`p-4 ${className}`}>
      <div className="space-y-4">
        <h3 className="text-md font-medium">Hourly Rate Configuration</h3>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="minimum-billable-time">Minimum Billable Time (minutes)</Label>
              <Input
                id="minimum-billable-time"
                type="number"
                value={minimumBillableTime.toString()}
                onChange={handleMinimumBillableTimeChange}
                placeholder="15"
                disabled={disabled}
                min={0}
                step={1}
                className={validationErrors.minimumBillableTime ? 'border-red-500' : ''}
              />
              {validationErrors.minimumBillableTime ? (
                <p className="text-sm text-red-500 mt-1">{validationErrors.minimumBillableTime}</p>
              ) : (
                <p className="text-sm text-gray-500 mt-1">
                  Minimum time to bill (e.g., 15 minutes)
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="round-up-to-nearest">Round Up To Nearest (minutes)</Label>
              <Input
                id="round-up-to-nearest"
                type="number"
                value={roundUpToNearest.toString()}
                onChange={handleRoundUpToNearestChange}
                placeholder="15"
                disabled={disabled}
                min={0}
                step={1}
                className={validationErrors.roundUpToNearest ? 'border-red-500' : ''}
              />
              {validationErrors.roundUpToNearest ? (
                <p className="text-sm text-red-500 mt-1">{validationErrors.roundUpToNearest}</p>
              ) : (
                <p className="text-sm text-gray-500 mt-1">
                  Round time entries up to nearest increment
                </p>
              )}
            </div>
          </div>

          {/* User Type Rates Section */}
          {onUserTypeRatesChange && (
            <div className="border p-3 rounded-md bg-gray-50">
              <h4 className="font-medium mb-2">User Type Rates</h4>
              
              {userTypeRates.length > 0 && (
                <div className="mb-3">
                  <div className="grid grid-cols-3 gap-2 font-medium text-sm mb-1">
                    <div>User Type</div>
                    <div>Rate</div>
                    <div></div>
                  </div>
                  {userTypeRates.map((item, index) => (
                    <div key={index} className="grid grid-cols-3 gap-2 items-center mb-1">
                      <div>{userTypeOptions.find(opt => opt.value === item.user_type)?.label || item.user_type}</div>
                      <div>${item.rate.toFixed(2)}</div>
                      <Button
                        type="button"
                        onClick={() => handleRemoveUserTypeRate(index)}
                        variant="ghost"
                        size="sm"
                        id={`remove-user-type-rate-${index}`}
                        disabled={disabled}
                        className="text-red-600 hover:text-red-800 p-0 h-8 w-8"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              
              <div className="grid grid-cols-3 gap-2 items-end">
                <div>
                  <Label htmlFor="new-user-type">User Type</Label>
                  <CustomSelect
                    id="new-user-type"
                    options={userTypeOptions}
                    onValueChange={setNewUserType}
                    value={newUserType}
                    placeholder="Select user type"
                    disabled={disabled}
                  />
                </div>
                <div>
                  <Label htmlFor="new-user-type-rate">Rate</Label>
                  <Input
                    id="new-user-type-rate"
                    type="number"
                    value={newUserTypeRate?.toString() || ''}
                    onChange={handleNewUserTypeRateChange}
                    placeholder="Enter rate"
                    disabled={disabled}
                    min={0}
                    step={0.01}
                    className={validationErrors.newUserTypeRate ? 'border-red-500' : ''}
                  />
                  {validationErrors.newUserTypeRate && (
                    <p className="text-sm text-red-500 mt-1">{validationErrors.newUserTypeRate}</p>
                  )}
                </div>
                <Button
                  type="button"
                  onClick={handleAddUserTypeRate}
                  id="add-user-type-rate"
                  disabled={disabled || !newUserType || newUserTypeRate === undefined || newUserTypeRate < 0}
                >
                  Add Rate
                </Button>
              </div>
            </div>
          )}

          {/* Overtime Section */}
          <div className="flex items-center space-x-2 pt-2">
            <Switch
              id="enable-overtime"
              checked={enableOvertime}
              onCheckedChange={handleEnableOvertimeChange}
              disabled={disabled}
            />
            <Label htmlFor="enable-overtime" className="cursor-pointer">
              Enable Overtime Rates
            </Label>
          </div>

          {enableOvertime && (
            <div className="grid grid-cols-2 gap-4 pl-6 border-l-2 border-gray-200">
              <div>
                <Label htmlFor="overtime-rate">Overtime Rate</Label>
                <Input
                  id="overtime-rate"
                  type="number"
                  value={overtimeRate?.toString() || ''}
                  onChange={handleOvertimeRateChange}
                  placeholder="Enter overtime rate"
                  disabled={disabled}
                  min={0}
                  step={0.01}
                  className={validationErrors.overtimeRate ? 'border-red-500' : ''}
                />
                {validationErrors.overtimeRate ? (
                  <p className="text-sm text-red-500 mt-1">{validationErrors.overtimeRate}</p>
                ) : (
                  <p className="text-sm text-gray-500 mt-1">
                    Rate applied to overtime hours
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="overtime-threshold">Overtime Threshold (hours)</Label>
                <Input
                  id="overtime-threshold"
                  type="number"
                  value={overtimeThreshold?.toString() || ''}
                  onChange={handleOvertimeThresholdChange}
                  placeholder="40"
                  disabled={disabled}
                  min={0}
                  step={1}
                  className={validationErrors.overtimeThreshold ? 'border-red-500' : ''}
                />
                {validationErrors.overtimeThreshold ? (
                  <p className="text-sm text-red-500 mt-1">{validationErrors.overtimeThreshold}</p>
                ) : (
                  <p className="text-sm text-gray-500 mt-1">
                    Hours per period before overtime applies
                  </p>
                )}
              </div>
            </div>
          )}

          {/* After Hours Rate Section */}
          <div className="flex items-center space-x-2 pt-2">
            <Switch
              id="enable-after-hours"
              checked={enableAfterHoursRate}
              onCheckedChange={handleEnableAfterHoursRateChange}
              disabled={disabled}
            />
            <Label htmlFor="enable-after-hours" className="cursor-pointer">
              Enable After-Hours Rate Multiplier
            </Label>
          </div>

          {enableAfterHoursRate && (
            <div className="pl-6 border-l-2 border-gray-200">
              <Label htmlFor="after-hours-multiplier">After-Hours Rate Multiplier</Label>
              <Input
                id="after-hours-multiplier"
                type="number"
                value={afterHoursMultiplier?.toString() || ''}
                onChange={handleAfterHoursMultiplierChange}
                placeholder="1.5"
                disabled={disabled}
                min={1}
                step={0.1}
                className={validationErrors.afterHoursMultiplier ? 'border-red-500' : ''}
              />
              {validationErrors.afterHoursMultiplier ? (
                <p className="text-sm text-red-500 mt-1">{validationErrors.afterHoursMultiplier}</p>
              ) : (
                <p className="text-sm text-gray-500 mt-1">
                  Multiplier applied to standard rate for after-hours work (e.g., 1.5 = 150% of standard rate)
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}