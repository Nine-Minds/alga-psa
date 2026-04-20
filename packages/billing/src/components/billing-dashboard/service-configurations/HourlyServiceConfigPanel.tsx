'use client'

import React, { useState, useEffect } from 'react';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Card } from '@alga-psa/ui/components/Card';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Button } from '@alga-psa/ui/components/Button';
import { IContractLineServiceHourlyConfig, IUserTypeRate } from '@alga-psa/types';
import { Trash2 } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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
  const { t } = useTranslation('msp/service-catalog');
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
      errors.minimumBillableTime = t('hourlyConfig.fields.minimumBillableTime.errorNegative', {
        defaultValue: 'Minimum billable time cannot be negative',
      });
    }

    if (roundUpToNearest < 0) {
      errors.roundUpToNearest = t('hourlyConfig.fields.roundUpToNearest.errorNegative', {
        defaultValue: 'Round up value cannot be negative',
      });
    }

    if (newUserTypeRate !== undefined && newUserTypeRate < 0) {
      errors.newUserTypeRate = t('hourlyConfig.fields.newUserTypeRate.errorNegative', {
        defaultValue: 'User type rate cannot be negative',
      });
    }

    setValidationErrors(errors);
  }, [
    minimumBillableTime,
    roundUpToNearest,
    newUserTypeRate,
    t
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
    {
      value: 'technician',
      label: t('hourlyConfig.userTypeRates.options.technician', {
        defaultValue: 'Technician',
      }),
    },
    {
      value: 'engineer',
      label: t('hourlyConfig.userTypeRates.options.engineer', {
        defaultValue: 'Engineer',
      }),
    },
    {
      value: 'consultant',
      label: t('hourlyConfig.userTypeRates.options.consultant', {
        defaultValue: 'Consultant',
      }),
    },
    {
      value: 'project_manager',
      label: t('hourlyConfig.userTypeRates.options.project_manager', {
        defaultValue: 'Project Manager',
      }),
    },
    {
      value: 'admin',
      label: t('hourlyConfig.userTypeRates.options.admin', {
        defaultValue: 'Administrator',
      }),
    }
  ];

  return (
    <Card className={`p-4 ${className}`}>
      <div className="space-y-4">
        <h3 className="text-md font-medium">
          {t('hourlyConfig.title', { defaultValue: 'Hourly Rate Configuration' })}
        </h3>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="minimum-billable-time">
                {t('hourlyConfig.fields.minimumBillableTime.label', {
                  defaultValue: 'Minimum Billable Time (minutes)',
                })}
              </Label>
              <Input
                id="minimum-billable-time"
                type="number"
                value={minimumBillableTime.toString()}
                onChange={handleMinimumBillableTimeChange}
                placeholder={t('hourlyConfig.fields.minimumBillableTime.placeholder', {
                  defaultValue: '15',
                })}
                disabled={disabled}
                min={0}
                step={1}
                className={validationErrors.minimumBillableTime ? 'border-red-500' : ''}
              />
              {validationErrors.minimumBillableTime ? (
                <p className="text-sm text-red-500 mt-1">{validationErrors.minimumBillableTime}</p>
              ) : (
                <p className="text-sm text-muted-foreground mt-1">
                  {t('hourlyConfig.fields.minimumBillableTime.help', {
                    defaultValue: 'Minimum time to bill (e.g., 15 minutes)',
                  })}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="round-up-to-nearest">
                {t('hourlyConfig.fields.roundUpToNearest.label', {
                  defaultValue: 'Round Up To Nearest (minutes)',
                })}
              </Label>
              <Input
                id="round-up-to-nearest"
                type="number"
                value={roundUpToNearest.toString()}
                onChange={handleRoundUpToNearestChange}
                placeholder={t('hourlyConfig.fields.roundUpToNearest.placeholder', {
                  defaultValue: '15',
                })}
                disabled={disabled}
                min={0}
                step={1}
                className={validationErrors.roundUpToNearest ? 'border-red-500' : ''}
              />
              {validationErrors.roundUpToNearest ? (
                <p className="text-sm text-red-500 mt-1">{validationErrors.roundUpToNearest}</p>
              ) : (
                <p className="text-sm text-muted-foreground mt-1">
                  {t('hourlyConfig.fields.roundUpToNearest.help', {
                    defaultValue: 'Round time entries up to nearest increment',
                  })}
                </p>
              )}
            </div>
          </div>

          {/* User Type Rates Section */}
          {onUserTypeRatesChange && (
            <div className="border p-3 rounded-md bg-muted">
              <h4 className="font-medium mb-2">
                {t('hourlyConfig.userTypeRates.title', {
                  defaultValue: 'User Type Rates',
                })}
              </h4>
              
              {userTypeRates.length > 0 && (
                <div className="mb-3">
                  <div className="grid grid-cols-3 gap-2 font-medium text-sm mb-1">
                    <div>
                      {t('hourlyConfig.userTypeRates.headers.userType', {
                        defaultValue: 'User Type',
                      })}
                    </div>
                    <div>
                      {t('hourlyConfig.userTypeRates.headers.rate', {
                        defaultValue: 'Rate',
                      })}
                    </div>
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
                  <Label htmlFor="new-user-type">
                    {t('hourlyConfig.fields.newUserType.label', {
                      defaultValue: 'User Type',
                    })}
                  </Label>
                  <CustomSelect
                    id="new-user-type"
                    options={userTypeOptions}
                    onValueChange={setNewUserType}
                    value={newUserType}
                    placeholder={t('hourlyConfig.fields.newUserType.placeholder', {
                      defaultValue: 'Select user type',
                    })}
                    disabled={disabled}
                  />
                </div>
                <div>
                  <Label htmlFor="new-user-type-rate">
                    {t('hourlyConfig.fields.newUserTypeRate.label', {
                      defaultValue: 'Rate',
                    })}
                  </Label>
                  <Input
                    id="new-user-type-rate"
                    type="number"
                    value={(newUserTypeRate !== undefined ? newUserTypeRate / 100 : '').toString()} // Display in dollars
                    onChange={handleNewUserTypeRateChange}
                    placeholder={t('hourlyConfig.fields.newUserTypeRate.placeholder', {
                      defaultValue: 'Enter rate',
                    })}
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
                  {t('hourlyConfig.userTypeRates.actions.addRate', {
                    defaultValue: 'Add Rate',
                  })}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
