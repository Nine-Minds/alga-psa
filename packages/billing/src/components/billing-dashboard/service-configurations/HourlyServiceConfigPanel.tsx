'use client'

import React, { useState, useEffect } from 'react';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Card } from '@alga-psa/ui/components/Card';
import { Switch } from '@alga-psa/ui/components/Switch';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Button } from '@alga-psa/ui/components/Button';
import { IContractLineServiceHourlyConfig, IUserTypeRate } from '@alga-psa/types';
import { Trash2 } from 'lucide-react';

interface HourlyServiceConfigPanelProps {
  configuration: Partial<IContractLineServiceHourlyConfig>;
  userTypeRates?: IUserTypeRate[];
  onConfigurationChange: (updates: Partial<IContractLineServiceHourlyConfig>) => void;
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

    if (newUserTypeRate !== undefined && newUserTypeRate < 0) {
      errors.newUserTypeRate = 'User type rate cannot be negative';
    }

    setValidationErrors(errors);
  }, [
    minimumBillableTime,
    roundUpToNearest,
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

  const handleNewUserTypeRateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value === '' ? undefined : Math.round(Number(e.target.value) * 100); // Store in cents
    setNewUserTypeRate(value);
  };

  const handleAddUserTypeRate = () => {
    if (!onUserTypeRatesChange || !newUserType || newUserTypeRate === undefined || newUserTypeRate < 0) {
      return;
    }

    const newRate: Partial<IUserTypeRate> = {
      user_type: newUserType,
      rate: newUserTypeRate // Already in cents from state
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
                      <div>${(item.rate / 100).toFixed(2)}</div> {/* Display in dollars */}
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
                    value={(newUserTypeRate !== undefined ? newUserTypeRate / 100 : '').toString()} // Display in dollars
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
        </div>
      </div>
    </Card>
  );
}
