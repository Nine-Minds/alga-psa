'use client';
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert'
import { ITimePeriodSettings } from '@alga-psa/types';
import { getActiveTimePeriodSettings, updateTimePeriodSettings, createTimePeriodSettings, deleteTimePeriodSettings } from '@alga-psa/scheduling/actions';
import { ISO8601String } from '@alga-psa/types';
import { formatISO, parseISO } from 'date-fns';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';

type FrequencyUnit = 'day' | 'week' | 'month' | 'year';

const END_OF_PERIOD = 0;

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const monthOptions = monthNames.map((name, index): { value: string; label: string } => ({
  value: (index + 1).toString(),
  label: name
}));

const weekDayNames = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'
];

const weekDayOptions = weekDayNames.map((name, index): { value: string; label: string } => ({
  value: (index + 1).toString(),
  label: name
}));

const frequencyUnitOptions: Array<{ value: FrequencyUnit; label: string }> = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' }
];

const getMonthName = (monthNumber: number): string => monthNames[monthNumber - 1];

const defaultFrequencyUnit: FrequencyUnit = 'month';

const TimePeriodSettings: React.FC = () => {
  const [settings, setSettings] = useState<ITimePeriodSettings[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewSettingForm, setShowNewSettingForm] = useState<boolean>(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState<boolean>(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [newSetting, setNewSetting] = useState<Partial<ITimePeriodSettings> & { frequency_unit: FrequencyUnit }>({
    start_day: 1,
    end_day: END_OF_PERIOD,
    frequency: 1,
    frequency_unit: defaultFrequencyUnit,
    is_active: true,
    effective_from: formatISO(new Date()) as ISO8601String,
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const activeSettings = await getActiveTimePeriodSettings();
      setSettings(activeSettings);
    } catch (err) {
      setError('Failed to fetch time period settings');
      console.error('Error fetching time period settings:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddSetting = async () => {
    setHasAttemptedSubmit(true);
    const errors: string[] = [];
    
    // Validate required fields
    if (!newSetting.frequency || newSetting.frequency < 1) {
      errors.push('Frequency must be at least 1');
    }
    
    if (newSetting.frequency_unit === 'week' || newSetting.frequency_unit === 'month') {
      if (!newSetting.start_day) {
        errors.push('Start day is required');
      }
      if (newSetting.end_day === undefined || newSetting.end_day === null) {
        errors.push('End day is required');
      }
    }
    
    if (newSetting.frequency_unit === 'year') {
      if (!newSetting.start_day_of_month) {
        errors.push('Start day of month is required');
      }
      if (newSetting.end_day_of_month === undefined || newSetting.end_day_of_month === null) {
        errors.push('End day of month is required');
      }
    }
    
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    
    try {
      setError(null);
      setValidationErrors([]);
      const createdSetting = await createTimePeriodSettings(newSetting);
      setSettings([...settings, createdSetting]);
      setNewSetting({
        start_day: 1,
        end_day: END_OF_PERIOD,
        frequency: 1,
        frequency_unit: defaultFrequencyUnit,
        is_active: true,
        effective_from: formatISO(new Date()) as ISO8601String,
      });
      setShowNewSettingForm(false);
      setHasAttemptedSubmit(false);
    } catch (err) {
      console.error('Error adding time period setting:', err);
      if (err instanceof Error && err.message === 'The specified time period overlaps with existing time periods') {
        setError('Error: This time period setting overlaps with an existing active setting.');
      } else {
        setError('Failed to add time period setting. Please check the values and try again.');
      }
    }
  };

  const handleUpdateSetting = async (updatedSetting: ITimePeriodSettings) => {
    try {
      setError(null); // Clear previous error before attempting to update
      await updateTimePeriodSettings(updatedSetting);
      await fetchSettings();
    } catch (error) {
      console.error('Error updating time period setting:', error);
      setError('Failed to update time period setting');
    }
  };

  const handleDeleteSetting = async (settingId: string) => {
    try {
      await deleteTimePeriodSettings(settingId);
      setSettings(settings.filter(s => s.time_period_settings_id !== settingId));
    } catch (error) {
      console.error('Error deleting time period setting:', error);
      setError('Failed to delete time period setting');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingIndicator 
          layout="stacked" 
          text="Loading time period settings..."
          spinnerProps={{ size: 'md' }}
        />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Time Period Settings</CardTitle>
        <CardDescription>Configure billing time period settings</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Help Text Section */}
          <Alert variant="info" className="mb-4">
            <AlertTitle>Understanding Time Period Settings</AlertTitle>
            <AlertDescription>
              <p className="text-xs mb-1">
                You can define multiple active settings to create complex billing cycles. End Day is the last day included in the period.
              </p>
              <p className="text-xs mb-1">
                For example, to set up semi-monthly periods (1st–15th and 16th–End of Month):
              </p>
              <ul className="list-disc list-inside text-xs mt-1 space-y-1">
                <li>
                  <strong>Setting 1:</strong> Start Day: 1, End Day: 15 → Period covers 1st through 15th
                </li>
                <li>
                  <strong>Setting 2:</strong> Start Day: 16, End Day: End of month → Period covers 16th through last day
                </li>
              </ul>
              <p className="text-xs mt-1">
                The system uses these settings to suggest and generate time periods. Ensure your settings cover the entire cycle without gaps.
              </p>
            </AlertDescription>
          </Alert>
          {/* End Help Text Section */}

          {settings.map((setting): React.JSX.Element => (
            <TimePeriodSettingItem
              key={setting.time_period_settings_id}
              setting={setting}
              onUpdate={handleUpdateSetting}
              onDelete={handleDeleteSetting}
            />
          ))}
          {showNewSettingForm ? (
            <NewTimePeriodSettingForm
              newSetting={newSetting}
              setNewSetting={setNewSetting}
              onAdd={handleAddSetting}
              onCancel={() => {
                setShowNewSettingForm(false);
                setHasAttemptedSubmit(false);
                setValidationErrors([]);
              }}
              hasAttemptedSubmit={hasAttemptedSubmit}
              validationErrors={validationErrors}
            />
          ) : (
            <Button id="add-new-setting-button" onClick={() => setShowNewSettingForm(true)}>Add New Time Period Setting</Button>
          )}
          {error && <div className="text-red-500">{error}</div>}
        </div>
      </CardContent>
    </Card>
  );
};

interface NewTimePeriodSettingFormProps {
  newSetting: Partial<ITimePeriodSettings> & { frequency_unit: FrequencyUnit };
  setNewSetting: React.Dispatch<React.SetStateAction<Partial<ITimePeriodSettings> & { frequency_unit: FrequencyUnit }>>;
  onAdd: () => void;
  onCancel: () => void;
  hasAttemptedSubmit: boolean;
  validationErrors: string[];
}

const NewTimePeriodSettingForm: React.FC<NewTimePeriodSettingFormProps> = ({ newSetting, setNewSetting, onAdd, onCancel, hasAttemptedSubmit, validationErrors }) => {
  const [useEndOfPeriod, setUseEndOfPeriod] = useState<boolean>(newSetting.end_day === END_OF_PERIOD);
  const [useEndOfMonthForYear, setUseEndOfMonthForYear] = useState<boolean>(newSetting.end_day_of_month === END_OF_PERIOD);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setNewSetting({ ...newSetting, [name]: parseInt(value, 10) });
  };

  const handleEndOfPeriodChange = (checked: boolean) => {
    setUseEndOfPeriod(checked);
    setNewSetting({ 
      ...newSetting, 
      end_day: checked ? END_OF_PERIOD : 31 
    });
  };

  const handleEndOfMonthForYearChange = (checked: boolean) => {
    setUseEndOfMonthForYear(checked);
    setNewSetting({ 
      ...newSetting, 
      end_day_of_month: checked ? END_OF_PERIOD : 31 
    });
  };

  const handleSelectChange = (name: string) => (value: string) => {
    if (name === 'frequency_unit') {
      setNewSetting({ ...newSetting, [name]: value as FrequencyUnit });
    } else if (name === 'start_month' || name === 'end_month' ||
               name === 'start_day' || name === 'end_day' ||
               name === 'start_day_of_month' || name === 'end_day_of_month') {
      setNewSetting({ ...newSetting, [name]: parseInt(value, 10) });
    }
  };

  const clearErrorIfSubmitted = () => {
    // This function would be called on input changes if we had access to parent state
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); onAdd(); }} className="border p-4 rounded-md space-y-4" noValidate>
      {hasAttemptedSubmit && validationErrors.length > 0 && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>
            <p className="font-medium mb-2">Please fill in the required fields:</p>
            <ul className="list-disc list-inside space-y-1">
              {validationErrors.map((err, index) => (
                <li key={index}>{err}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="frequency">Frequency *</Label>
        <Input
          id="frequency"
          name="frequency"
          type="number"
          min={1}
          value={newSetting.frequency}
          onChange={handleInputChange}
          placeholder="Enter frequency"
          className={`!w-24 ${hasAttemptedSubmit && (!newSetting.frequency || newSetting.frequency < 1) ? 'border-red-500' : ''}`}
        />
      </div>

      <div className="space-y-2">
        <Label>Frequency Unit *</Label>
        <CustomSelect
          value={newSetting.frequency_unit}
          onValueChange={handleSelectChange('frequency_unit')}
          options={frequencyUnitOptions}
          placeholder="Select frequency unit"
          className={`!w-fit ${hasAttemptedSubmit && !newSetting.frequency_unit ? 'border-red-500' : ''}`}
        />
      </div>

      {(newSetting.frequency_unit === 'week' || newSetting.frequency_unit === 'month') && (
        <>
          <div className="space-y-2">
            <Label htmlFor="start_day">Start Day *</Label>
            {newSetting.frequency_unit === 'week' ? (
              <CustomSelect
                id="start_day"
                value={newSetting.start_day?.toString()}
                onValueChange={handleSelectChange('start_day')}
                options={weekDayOptions}
                placeholder="Select day"
                className={`!w-fit ${hasAttemptedSubmit && !newSetting.start_day ? 'border-red-500' : ''}`}
              />
            ) : (
              <Input
                id="start_day"
                name="start_day"
                type="number"
                min={1}
                max={31}
                value={newSetting.start_day}
                onChange={handleInputChange}
                placeholder="Enter start day"
                className={`!w-20 ${hasAttemptedSubmit && !newSetting.start_day ? 'border-red-500' : ''}`}
              />
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="use_end_of_period"
                checked={useEndOfPeriod}
                onChange={(event) => handleEndOfPeriodChange(event.target.checked)}
              />
              <Label htmlFor="use_end_of_period">End of {newSetting.frequency_unit}</Label>
            </div>

            {!useEndOfPeriod && (
              <div className="space-y-2">
                <Label htmlFor="end_day">End Day *</Label>
                {newSetting.frequency_unit === 'week' ? (
                  <CustomSelect
                    id="end_day"
                    value={newSetting.end_day === END_OF_PERIOD ? '' : newSetting.end_day?.toString()}
                    onValueChange={handleSelectChange('end_day')}
                    options={weekDayOptions}
                    placeholder="Select day"
                    className={`!w-fit ${hasAttemptedSubmit && (newSetting.end_day === undefined || newSetting.end_day === null) ? 'border-red-500' : ''}`}
                  />
                ) : (
                  <Input
                    id="end_day"
                    name="end_day"
                    type="number"
                    min={1}
                    max={31}
                    value={newSetting.end_day === END_OF_PERIOD ? '' : newSetting.end_day}
                    onChange={handleInputChange}
                    placeholder="Enter end day"
                    className={`!w-20 ${hasAttemptedSubmit && (newSetting.end_day === undefined || newSetting.end_day === null) ? 'border-red-500' : ''}`}
                  />
                )}
              </div>
            )}
          </div>
        </>
      )}

      {newSetting.frequency_unit === 'year' && (
        <>
          <div className="space-y-2">
            <Label>Start Month</Label>
            <CustomSelect
              value={(newSetting.start_month || 1).toString()}
              onValueChange={handleSelectChange('start_month')}
              options={monthOptions}
              className="!w-fit"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="start_day_of_month">Start Day of Month *</Label>
            <Input
              id="start_day_of_month"
              name="start_day_of_month"
              type="number"
              min={1}
              max={31}
              value={newSetting.start_day_of_month}
              onChange={handleInputChange}
              placeholder="Enter start day"
              className={`!w-20 ${hasAttemptedSubmit && !newSetting.start_day_of_month ? 'border-red-500' : ''}`}
            />
          </div>

          <div className="space-y-2">
            <Label>End Month</Label>
            <CustomSelect
              value={(newSetting.end_month || 12).toString()}
              onValueChange={handleSelectChange('end_month')}
              options={monthOptions}
              className="!w-fit"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="use_end_of_month_for_year"
                checked={useEndOfMonthForYear}
                onChange={(event) => handleEndOfMonthForYearChange(event.target.checked)}
              />
              <Label htmlFor="use_end_of_month_for_year">End of month</Label>
            </div>

            {!useEndOfMonthForYear && (
              <div className="space-y-2">
                <Label htmlFor="end_day_of_month">End Day of Month *</Label>
                <Input
                  id="end_day_of_month"
                  name="end_day_of_month"
                  type="number"
                  min={1}
                  max={31}
                  value={newSetting.end_day_of_month === END_OF_PERIOD ? '' : newSetting.end_day_of_month}
                  onChange={handleInputChange}
                  placeholder="Enter end day"
                  className={`!w-20 ${hasAttemptedSubmit && (newSetting.end_day_of_month === undefined || newSetting.end_day_of_month === null) ? 'border-red-500' : ''}`}
                />
              </div>
            )}
          </div>
        </>
      )}

      <div className="space-x-2">
        <Button 
          id="add-setting-button" 
          type="submit"
          className={!newSetting.frequency || newSetting.frequency < 1 ? 'opacity-50' : ''}
        >
          Add Time Period Setting
        </Button>
        <Button id="cancel-add-button" onClick={onCancel} variant="outline" type="button">Cancel</Button>
      </div>
    </form>
  );
};

interface TimePeriodSettingItemProps {
  setting: ITimePeriodSettings;
  onUpdate: (setting: ITimePeriodSettings) => void;
  onDelete: (id: string) => void;
}

const TimePeriodSettingItem: React.FC<TimePeriodSettingItemProps> = ({ setting, onUpdate, onDelete }) => {
  const [editedSetting, setEditedSetting] = useState<ITimePeriodSettings>({
    ...setting,
    frequency_unit: setting.frequency_unit as FrequencyUnit || defaultFrequencyUnit
  });
  const [isEditing, setIsEditing] = useState(false);
  const [useEndOfPeriod, setUseEndOfPeriod] = useState<boolean>(setting.end_day === END_OF_PERIOD);
  const [useEndOfMonthForYear, setUseEndOfMonthForYear] = useState<boolean>(setting.end_day_of_month === END_OF_PERIOD);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setEditedSetting({ ...editedSetting, [name]: parseInt(value, 10) });
  };

  const handleEndOfPeriodChange = (checked: boolean) => {
    setUseEndOfPeriod(checked);
    setEditedSetting({ 
      ...editedSetting, 
      end_day: checked ? END_OF_PERIOD : 31 
    });
  };

  const handleEndOfMonthForYearChange = (checked: boolean) => {
    setUseEndOfMonthForYear(checked);
    setEditedSetting({ 
      ...editedSetting, 
      end_day_of_month: checked ? END_OF_PERIOD : 31 
    });
  };

  const handleSelectChange = (name: string) => (value: string) => {
    if (name === 'frequency_unit') {
      setEditedSetting({ ...editedSetting, [name]: value as FrequencyUnit });
    } else if (name === 'start_month' || name === 'end_month' ||
               name === 'start_day' || name === 'end_day' ||
               name === 'start_day_of_month' || name === 'end_day_of_month') {
      setEditedSetting({ ...editedSetting, [name]: parseInt(value, 10) });
    }
  };

  const handleSave = () => {
    setHasAttemptedSubmit(true);
    const errors: string[] = [];
    
    // Validate required fields
    if (!editedSetting.frequency || editedSetting.frequency < 1) {
      errors.push('Frequency must be at least 1');
    }
    
    if (editedSetting.frequency_unit === 'week' || editedSetting.frequency_unit === 'month') {
      if (!editedSetting.start_day) {
        errors.push('Start day is required');
      }
      if (editedSetting.end_day === undefined || editedSetting.end_day === null) {
        errors.push('End day is required');
      }
    }
    
    if (editedSetting.frequency_unit === 'year') {
      if (!editedSetting.start_day_of_month) {
        errors.push('Start day of month is required');
      }
      if (editedSetting.end_day_of_month === undefined || editedSetting.end_day_of_month === null) {
        errors.push('End day of month is required');
      }
    }
    
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    
    onUpdate(editedSetting);
    setIsEditing(false);
    setHasAttemptedSubmit(false);
    setValidationErrors([]);
  };

  const formatEndDay = (day: number | undefined, frequencyUnit: string): string => {
    if (day === END_OF_PERIOD) {
      return `End of ${frequencyUnit}`;
    }
    if (frequencyUnit === 'week' && day) {
      return weekDayNames[day - 1];
    }
    return day?.toString() || 'Not set';
  };

  return (
    <div className="border p-4 rounded-md">
      {isEditing ? (
        <form onSubmit={(e) => { e.preventDefault(); handleSave(); }} className="space-y-4" noValidate>
          {hasAttemptedSubmit && validationErrors.length > 0 && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>
                <p className="font-medium mb-2">Please fill in the required fields:</p>
                <ul className="list-disc list-inside space-y-1">
                  {validationErrors.map((err, index) => (
                    <li key={index}>{err}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="frequency">Frequency *</Label>
              <Input
                id="frequency"
                name="frequency"
                type="number"
                min={1}
                value={editedSetting.frequency}
                onChange={handleInputChange}
                placeholder="Enter frequency"
                className={`!w-24 ${hasAttemptedSubmit && (!editedSetting.frequency || editedSetting.frequency < 1) ? 'border-red-500' : ''}`}
              />
            </div>

            <div className="space-y-2">
              <Label>Frequency Unit *</Label>
              <CustomSelect
                value={editedSetting.frequency_unit}
                onValueChange={handleSelectChange('frequency_unit')}
                options={frequencyUnitOptions}
                placeholder="Select frequency unit"
                className={`!w-fit ${hasAttemptedSubmit && !editedSetting.frequency_unit ? 'border-red-500' : ''}`}
              />
            </div>

            {(editedSetting.frequency_unit === 'week' || editedSetting.frequency_unit === 'month') && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="start_day">Start Day *</Label>
                  {editedSetting.frequency_unit === 'week' ? (
                    <CustomSelect
                      id="start_day"
                      value={editedSetting.start_day?.toString()}
                      onValueChange={handleSelectChange('start_day')}
                      options={weekDayOptions}
                      placeholder="Select day"
                      className={`!w-fit ${hasAttemptedSubmit && !editedSetting.start_day ? 'border-red-500' : ''}`}
                    />
                  ) : (
                    <Input
                      id="start_day"
                      name="start_day"
                      type="number"
                      min={1}
                      max={31}
                      value={editedSetting.start_day}
                      onChange={handleInputChange}
                      placeholder="Enter start day"
                      className={`!w-20 ${hasAttemptedSubmit && !editedSetting.start_day ? 'border-red-500' : ''}`}
                    />
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="use_end_of_period_edit"
                      checked={useEndOfPeriod}
                      onChange={(event) => handleEndOfPeriodChange(event.target.checked)}
                    />
                    <Label htmlFor="use_end_of_period_edit">End of {editedSetting.frequency_unit}</Label>
                  </div>

                  {!useEndOfPeriod && (
                    <div className="space-y-2">
                      <Label htmlFor="end_day">End Day *</Label>
                      {editedSetting.frequency_unit === 'week' ? (
                        <CustomSelect
                          id="end_day"
                          value={editedSetting.end_day === END_OF_PERIOD ? '' : editedSetting.end_day?.toString()}
                          onValueChange={handleSelectChange('end_day')}
                          options={weekDayOptions}
                          placeholder="Select day"
                          className={`!w-fit ${hasAttemptedSubmit && (editedSetting.end_day === undefined || editedSetting.end_day === null) ? 'border-red-500' : ''}`}
                        />
                      ) : (
                        <Input
                          id="end_day"
                          name="end_day"
                          type="number"
                          min={1}
                          max={31}
                          value={editedSetting.end_day === END_OF_PERIOD ? '' : editedSetting.end_day}
                          onChange={handleInputChange}
                          placeholder="Enter end day"
                          className={`!w-20 ${hasAttemptedSubmit && (editedSetting.end_day === undefined || editedSetting.end_day === null) ? 'border-red-500' : ''}`}
                        />
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {editedSetting.frequency_unit === 'year' && (
              <>
                <div className="space-y-2">
                  <Label>Start Month</Label>
                  <CustomSelect
                    value={(editedSetting.start_month || 1).toString()}
                    onValueChange={handleSelectChange('start_month')}
                    options={monthOptions}
                    className="!w-fit"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="start_day_of_month">Start Day of Month *</Label>
                  <Input
                    id="start_day_of_month"
                    name="start_day_of_month"
                    type="number"
                    min={1}
                    max={31}
                    value={editedSetting.start_day_of_month}
                    onChange={handleInputChange}
                    placeholder="Enter start day"
                    className={`!w-20 ${hasAttemptedSubmit && !editedSetting.start_day_of_month ? 'border-red-500' : ''}`}
                  />
                </div>

                <div className="space-y-2">
                  <Label>End Month</Label>
                  <CustomSelect
                    value={(editedSetting.end_month || 12).toString()}
                    onValueChange={handleSelectChange('end_month')}
                    options={monthOptions}
                    className="!w-fit"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="use_end_of_month_for_year_edit"
                      checked={useEndOfMonthForYear}
                      onChange={(event) => handleEndOfMonthForYearChange(event.target.checked)}
                    />
                    <Label htmlFor="use_end_of_month_for_year_edit">End of month</Label>
                  </div>

                  {!useEndOfMonthForYear && (
                    <div className="space-y-2">
                      <Label htmlFor="end_day_of_month">End Day of Month *</Label>
                      <Input
                        id="end_day_of_month"
                        name="end_day_of_month"
                        type="number"
                        min={1}
                        max={31}
                        value={editedSetting.end_day_of_month === END_OF_PERIOD ? '' : editedSetting.end_day_of_month}
                        onChange={handleInputChange}
                        placeholder="Enter end day"
                        className={`!w-20 ${hasAttemptedSubmit && (editedSetting.end_day_of_month === undefined || editedSetting.end_day_of_month === null) ? 'border-red-500' : ''}`}
                      />
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="space-x-2">
              <Button 
                id="save-setting-button" 
                type="submit"
                className={!editedSetting.frequency || editedSetting.frequency < 1 ? 'opacity-50' : ''}
              >
                Save
              </Button>
              <Button 
                id="cancel-edit-button" 
                onClick={() => {
                  setIsEditing(false);
                  setHasAttemptedSubmit(false);
                  setValidationErrors([]);
                }} 
                variant="outline" 
                type="button"
              >
                Cancel
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <>
          <p>Frequency: {setting.frequency} {setting.frequency_unit}(s)</p>
          {(setting.frequency_unit === 'week' || setting.frequency_unit === 'month') && (
            <>
              <p>Start Day: {setting.frequency_unit === 'week' ? weekDayNames[(setting.start_day ?? 1) - 1] : setting.start_day}</p>
              <p>End Day: {formatEndDay(setting.end_day, setting.frequency_unit)}</p>
            </>
          )}
          {setting.frequency_unit === 'year' && (
            <>
              <p>Start: {getMonthName(setting.start_month || 1)} {setting.start_day_of_month}</p>
              <p>End: {getMonthName(setting.end_month || 12)} {
                setting.end_day_of_month === END_OF_PERIOD ? 
                'End of month' : 
                setting.end_day_of_month
              }</p>
            </>
          )}
          <p>Effective From: {parseISO(setting.effective_from).toLocaleString()}</p>
          <p>Effective To: {setting.effective_to ? parseISO(setting.effective_to).toLocaleString() : 'No end'}</p>
          <div className="space-x-2 mt-2">
            <Button id="edit-setting-button" onClick={() => setIsEditing(true)}>Edit</Button>
            <Button id="delete-setting-button" onClick={() => onDelete(setting.time_period_settings_id)} variant="destructive">Delete</Button>
          </div>
        </>
      )}
    </div>
  );
};

export default TimePeriodSettings;
