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
import { getActiveTimePeriodSettings, updateTimePeriodSettings, createTimePeriodSettings, deleteTimePeriodSettings } from '../../../actions/time-period-settings-actions/timePeriodSettingsActions';
import { ISO8601String } from '@alga-psa/types';
import { formatISO, parseISO } from 'date-fns';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

type FrequencyUnit = 'day' | 'week' | 'month' | 'year';

const END_OF_PERIOD = 0;

const MONTH_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const WEEK_DAY_NUMBERS = [1, 2, 3, 4, 5, 6, 7] as const;
const FREQUENCY_UNITS: readonly FrequencyUnit[] = ['day', 'week', 'month', 'year'];

const defaultFrequencyUnit: FrequencyUnit = 'month';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Month, weekday and frequency-unit labels are read from the locale pack rather than
 * baked into module-level arrays: a constant evaluated at import time can never be
 * translated, and nothing in the audit tooling can see it.
 */
function useTimePeriodLabels(t: Translate) {
  const monthName = React.useCallback(
    (monthNumber: number) => t(`timeEntry.timePeriods.months.${monthNumber}`),
    [t]
  );
  const weekDayName = React.useCallback(
    (dayNumber: number) => t(`timeEntry.timePeriods.weekDays.${dayNumber}`),
    [t]
  );
  const monthOptions = React.useMemo(
    () => MONTH_NUMBERS.map((month) => ({ value: month.toString(), label: monthName(month) })),
    [monthName]
  );
  const weekDayOptions = React.useMemo(
    () => WEEK_DAY_NUMBERS.map((day) => ({ value: day.toString(), label: weekDayName(day) })),
    [weekDayName]
  );
  const frequencyUnitOptions = React.useMemo(
    () => FREQUENCY_UNITS.map((unit) => ({ value: unit, label: t(`timeEntry.timePeriods.units.${unit}`) })),
    [t]
  );

  return { monthName, weekDayName, monthOptions, weekDayOptions, frequencyUnitOptions };
}

function isReturnedActionError(value: unknown): value is ActionMessageError | ActionPermissionError {
  return isActionMessageError(value) || isActionPermissionError(value);
}

const TimePeriodSettings: React.FC = () => {
  const { t } = useTranslation(['msp/settings', 'common']);
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
      if (isReturnedActionError(activeSettings)) {
        setError(getErrorMessage(activeSettings));
        setSettings([]);
        return;
      }
      setSettings(activeSettings);
    } catch (err) {
      setError(t('timeEntry.timePeriods.errors.fetch'));
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
      errors.push(t('timeEntry.timePeriods.validation.frequencyMin'));
    }
    
    if (newSetting.frequency_unit === 'week' || newSetting.frequency_unit === 'month') {
      if (!newSetting.start_day) {
        errors.push(t('timeEntry.timePeriods.validation.startDayRequired'));
      }
      if (newSetting.end_day === undefined || newSetting.end_day === null) {
        errors.push(t('timeEntry.timePeriods.validation.endDayRequired'));
      }
    }
    
    if (newSetting.frequency_unit === 'year') {
      if (!newSetting.start_day_of_month) {
        errors.push(t('timeEntry.timePeriods.validation.startDayOfMonthRequired'));
      }
      if (newSetting.end_day_of_month === undefined || newSetting.end_day_of_month === null) {
        errors.push(t('timeEntry.timePeriods.validation.endDayOfMonthRequired'));
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
      if (isReturnedActionError(createdSetting)) {
        setError(getErrorMessage(createdSetting));
        return;
      }
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
        setError(t('timeEntry.timePeriods.errors.overlap'));
      } else {
        setError(t('timeEntry.timePeriods.errors.add'));
      }
    }
  };

  const handleUpdateSetting = async (updatedSetting: ITimePeriodSettings) => {
    try {
      setError(null); // Clear previous error before attempting to update
      const result = await updateTimePeriodSettings(updatedSetting);
      if (isReturnedActionError(result)) {
        setError(getErrorMessage(result));
        return;
      }
      await fetchSettings();
    } catch (error) {
      console.error('Error updating time period setting:', error);
      setError(t('timeEntry.timePeriods.errors.update'));
    }
  };

  const handleDeleteSetting = async (settingId: string) => {
    try {
      const result = await deleteTimePeriodSettings(settingId);
      if (isReturnedActionError(result)) {
        setError(getErrorMessage(result));
        return;
      }
      setSettings(settings.filter(s => s.time_period_settings_id !== settingId));
    } catch (error) {
      console.error('Error deleting time period setting:', error);
      setError(t('timeEntry.timePeriods.errors.delete'));
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingIndicator 
          layout="stacked" 
          text={t('timeEntry.timePeriods.loading')}
          spinnerProps={{ size: 'md' }}
        />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('timeEntry.timePeriods.title')}</CardTitle>
        <CardDescription>{t('timeEntry.timePeriods.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Help Text Section */}
          <Alert variant="info" className="mb-4">
            <AlertTitle>{t('timeEntry.timePeriods.help.title')}</AlertTitle>
            <AlertDescription>
              <p className="text-xs mb-1">{t('timeEntry.timePeriods.help.intro')}</p>
              <p className="text-xs mb-1">{t('timeEntry.timePeriods.help.exampleIntro')}</p>
              <ul className="list-disc list-inside text-xs mt-1 space-y-1">
                <li>
                  <strong>{t('timeEntry.timePeriods.help.firstSettingLabel')}</strong>{' '}
                  {t('timeEntry.timePeriods.help.firstSetting')}
                </li>
                <li>
                  <strong>{t('timeEntry.timePeriods.help.secondSettingLabel')}</strong>{' '}
                  {t('timeEntry.timePeriods.help.secondSetting')}
                </li>
              </ul>
              <p className="text-xs mt-1">{t('timeEntry.timePeriods.help.outro')}</p>
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
            <Button id="add-new-setting-button" onClick={() => setShowNewSettingForm(true)}>{t('timeEntry.timePeriods.addNew')}</Button>
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
  const { t } = useTranslation(['msp/settings', 'common']);
  const { monthOptions, weekDayOptions, frequencyUnitOptions } = useTimePeriodLabels(t);
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
            <p className="font-medium mb-2">{t('timeEntry.timePeriods.form.requiredFields')}</p>
            <ul className="list-disc list-inside space-y-1">
              {validationErrors.map((err, index) => (
                <li key={index}>{err}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="frequency">{t('timeEntry.timePeriods.form.frequency')}</Label>
        <Input
          id="frequency"
          name="frequency"
          type="number"
          min={1}
          value={newSetting.frequency}
          onChange={handleInputChange}
          placeholder={t('timeEntry.timePeriods.form.frequencyPlaceholder')}
          className={`!w-24 ${hasAttemptedSubmit && (!newSetting.frequency || newSetting.frequency < 1) ? 'border-red-500' : ''}`}
        />
      </div>

      <div className="space-y-2">
        <Label>{t('timeEntry.timePeriods.form.frequencyUnit')}</Label>
        <CustomSelect
          value={newSetting.frequency_unit}
          onValueChange={handleSelectChange('frequency_unit')}
          options={frequencyUnitOptions}
          placeholder={t('timeEntry.timePeriods.form.frequencyUnitPlaceholder')}
          className={`!w-fit ${hasAttemptedSubmit && !newSetting.frequency_unit ? 'border-red-500' : ''}`}
        />
      </div>

      {(newSetting.frequency_unit === 'week' || newSetting.frequency_unit === 'month') && (
        <>
          <div className="space-y-2">
            <Label htmlFor="start_day">{t('timeEntry.timePeriods.form.startDay')}</Label>
            {newSetting.frequency_unit === 'week' ? (
              <CustomSelect
                id="start_day"
                value={newSetting.start_day?.toString()}
                onValueChange={handleSelectChange('start_day')}
                options={weekDayOptions}
                placeholder={t('timeEntry.timePeriods.form.selectDay')}
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
                placeholder={t('timeEntry.timePeriods.form.startDayPlaceholder')}
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
              <Label htmlFor="use_end_of_period">{t('timeEntry.timePeriods.form.endOfUnit', { unit: t(`timeEntry.timePeriods.units.${newSetting.frequency_unit}`) })}</Label>
            </div>

            {!useEndOfPeriod && (
              <div className="space-y-2">
                <Label htmlFor="end_day">{t('timeEntry.timePeriods.form.endDay')}</Label>
                {newSetting.frequency_unit === 'week' ? (
                  <CustomSelect
                    id="end_day"
                    value={newSetting.end_day === END_OF_PERIOD ? '' : newSetting.end_day?.toString()}
                    onValueChange={handleSelectChange('end_day')}
                    options={weekDayOptions}
                    placeholder={t('timeEntry.timePeriods.form.selectDay')}
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
                    placeholder={t('timeEntry.timePeriods.form.endDayPlaceholder')}
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
            <Label>{t('timeEntry.timePeriods.form.startMonth')}</Label>
            <CustomSelect
              value={(newSetting.start_month || 1).toString()}
              onValueChange={handleSelectChange('start_month')}
              options={monthOptions}
              className="!w-fit"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="start_day_of_month">{t('timeEntry.timePeriods.form.startDayOfMonth')}</Label>
            <Input
              id="start_day_of_month"
              name="start_day_of_month"
              type="number"
              min={1}
              max={31}
              value={newSetting.start_day_of_month}
              onChange={handleInputChange}
              placeholder={t('timeEntry.timePeriods.form.startDayPlaceholder')}
              className={`!w-20 ${hasAttemptedSubmit && !newSetting.start_day_of_month ? 'border-red-500' : ''}`}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('timeEntry.timePeriods.form.endMonth')}</Label>
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
              <Label htmlFor="use_end_of_month_for_year">{t('timeEntry.timePeriods.form.endOfMonth')}</Label>
            </div>

            {!useEndOfMonthForYear && (
              <div className="space-y-2">
                <Label htmlFor="end_day_of_month">{t('timeEntry.timePeriods.form.endDayOfMonth')}</Label>
                <Input
                  id="end_day_of_month"
                  name="end_day_of_month"
                  type="number"
                  min={1}
                  max={31}
                  value={newSetting.end_day_of_month === END_OF_PERIOD ? '' : newSetting.end_day_of_month}
                  onChange={handleInputChange}
                  placeholder={t('timeEntry.timePeriods.form.endDayPlaceholder')}
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
          {t('timeEntry.timePeriods.form.add')}
        </Button>
        <Button id="cancel-add-button" onClick={onCancel} variant="outline" type="button">{t('common:actions.cancel')}</Button>
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
  const { t } = useTranslation(['msp/settings', 'common']);
  const { monthName, weekDayName, monthOptions, weekDayOptions, frequencyUnitOptions } = useTimePeriodLabels(t);
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
      errors.push(t('timeEntry.timePeriods.validation.frequencyMin'));
    }
    
    if (editedSetting.frequency_unit === 'week' || editedSetting.frequency_unit === 'month') {
      if (!editedSetting.start_day) {
        errors.push(t('timeEntry.timePeriods.validation.startDayRequired'));
      }
      if (editedSetting.end_day === undefined || editedSetting.end_day === null) {
        errors.push(t('timeEntry.timePeriods.validation.endDayRequired'));
      }
    }
    
    if (editedSetting.frequency_unit === 'year') {
      if (!editedSetting.start_day_of_month) {
        errors.push(t('timeEntry.timePeriods.validation.startDayOfMonthRequired'));
      }
      if (editedSetting.end_day_of_month === undefined || editedSetting.end_day_of_month === null) {
        errors.push(t('timeEntry.timePeriods.validation.endDayOfMonthRequired'));
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
      return t('timeEntry.timePeriods.form.endOfUnit', { unit: t(`timeEntry.timePeriods.units.${frequencyUnit}`) });
    }
    if (frequencyUnit === 'week' && day) {
      return weekDayName(day);
    }
    return day?.toString() || t('timeEntry.timePeriods.summary.notSet');
  };

  return (
    <div className="border p-4 rounded-md">
      {isEditing ? (
        <form onSubmit={(e) => { e.preventDefault(); handleSave(); }} className="space-y-4" noValidate>
          {hasAttemptedSubmit && validationErrors.length > 0 && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>
                <p className="font-medium mb-2">{t('timeEntry.timePeriods.form.requiredFields')}</p>
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
              <Label htmlFor="frequency">{t('timeEntry.timePeriods.form.frequency')}</Label>
              <Input
                id="frequency"
                name="frequency"
                type="number"
                min={1}
                value={editedSetting.frequency}
                onChange={handleInputChange}
                placeholder={t('timeEntry.timePeriods.form.frequencyPlaceholder')}
                className={`!w-24 ${hasAttemptedSubmit && (!editedSetting.frequency || editedSetting.frequency < 1) ? 'border-red-500' : ''}`}
              />
            </div>

            <div className="space-y-2">
              <Label>{t('timeEntry.timePeriods.form.frequencyUnit')}</Label>
              <CustomSelect
                value={editedSetting.frequency_unit}
                onValueChange={handleSelectChange('frequency_unit')}
                options={frequencyUnitOptions}
                placeholder={t('timeEntry.timePeriods.form.frequencyUnitPlaceholder')}
                className={`!w-fit ${hasAttemptedSubmit && !editedSetting.frequency_unit ? 'border-red-500' : ''}`}
              />
            </div>

            {(editedSetting.frequency_unit === 'week' || editedSetting.frequency_unit === 'month') && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="start_day">{t('timeEntry.timePeriods.form.startDay')}</Label>
                  {editedSetting.frequency_unit === 'week' ? (
                    <CustomSelect
                      id="start_day"
                      value={editedSetting.start_day?.toString()}
                      onValueChange={handleSelectChange('start_day')}
                      options={weekDayOptions}
                      placeholder={t('timeEntry.timePeriods.form.selectDay')}
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
                      placeholder={t('timeEntry.timePeriods.form.startDayPlaceholder')}
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
                    <Label htmlFor="use_end_of_period_edit">{t('timeEntry.timePeriods.form.endOfUnit', { unit: t(`timeEntry.timePeriods.units.${editedSetting.frequency_unit}`) })}</Label>
                  </div>

                  {!useEndOfPeriod && (
                    <div className="space-y-2">
                      <Label htmlFor="end_day">{t('timeEntry.timePeriods.form.endDay')}</Label>
                      {editedSetting.frequency_unit === 'week' ? (
                        <CustomSelect
                          id="end_day"
                          value={editedSetting.end_day === END_OF_PERIOD ? '' : editedSetting.end_day?.toString()}
                          onValueChange={handleSelectChange('end_day')}
                          options={weekDayOptions}
                          placeholder={t('timeEntry.timePeriods.form.selectDay')}
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
                          placeholder={t('timeEntry.timePeriods.form.endDayPlaceholder')}
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
                  <Label>{t('timeEntry.timePeriods.form.startMonth')}</Label>
                  <CustomSelect
                    value={(editedSetting.start_month || 1).toString()}
                    onValueChange={handleSelectChange('start_month')}
                    options={monthOptions}
                    className="!w-fit"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="start_day_of_month">{t('timeEntry.timePeriods.form.startDayOfMonth')}</Label>
                  <Input
                    id="start_day_of_month"
                    name="start_day_of_month"
                    type="number"
                    min={1}
                    max={31}
                    value={editedSetting.start_day_of_month}
                    onChange={handleInputChange}
                    placeholder={t('timeEntry.timePeriods.form.startDayPlaceholder')}
                    className={`!w-20 ${hasAttemptedSubmit && !editedSetting.start_day_of_month ? 'border-red-500' : ''}`}
                  />
                </div>

                <div className="space-y-2">
                  <Label>{t('timeEntry.timePeriods.form.endMonth')}</Label>
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
                    <Label htmlFor="use_end_of_month_for_year_edit">{t('timeEntry.timePeriods.form.endOfMonth')}</Label>
                  </div>

                  {!useEndOfMonthForYear && (
                    <div className="space-y-2">
                      <Label htmlFor="end_day_of_month">{t('timeEntry.timePeriods.form.endDayOfMonth')}</Label>
                      <Input
                        id="end_day_of_month"
                        name="end_day_of_month"
                        type="number"
                        min={1}
                        max={31}
                        value={editedSetting.end_day_of_month === END_OF_PERIOD ? '' : editedSetting.end_day_of_month}
                        onChange={handleInputChange}
                        placeholder={t('timeEntry.timePeriods.form.endDayPlaceholder')}
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
                {t('common:actions.save')}
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
                {t('common:actions.cancel')}
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <>
          <p>{t('timeEntry.timePeriods.summary.frequency', { count: setting.frequency, unit: t(`timeEntry.timePeriods.units.${setting.frequency_unit}`) })}</p>
          {(setting.frequency_unit === 'week' || setting.frequency_unit === 'month') && (
            <>
              <p>{t('timeEntry.timePeriods.summary.startDay', { value: setting.frequency_unit === 'week' ? weekDayName(setting.start_day ?? 1) : setting.start_day })}</p>
              <p>{t('timeEntry.timePeriods.summary.endDay', { value: formatEndDay(setting.end_day, setting.frequency_unit) })}</p>
            </>
          )}
          {setting.frequency_unit === 'year' && (
            <>
              <p>{t('timeEntry.timePeriods.summary.start', { value: `${monthName(setting.start_month || 1)} ${setting.start_day_of_month}` })}</p>
              <p>{t('timeEntry.timePeriods.summary.end', {
                value: setting.end_day_of_month === END_OF_PERIOD
                  ? `${monthName(setting.end_month || 12)} ${t('timeEntry.timePeriods.form.endOfMonth')}`
                  : `${monthName(setting.end_month || 12)} ${setting.end_day_of_month}`,
              })}</p>
            </>
          )}
          <p>{t('timeEntry.timePeriods.summary.effectiveFrom', { value: parseISO(setting.effective_from).toLocaleString() })}</p>
          <p>{t('timeEntry.timePeriods.summary.effectiveTo', { value: setting.effective_to ? parseISO(setting.effective_to).toLocaleString() : t('timeEntry.timePeriods.summary.noEnd') })}</p>
          <div className="space-x-2 mt-2">
            <Button id="edit-setting-button" onClick={() => setIsEditing(true)}>{t('common:actions.edit')}</Button>
            <Button id="delete-setting-button" onClick={() => onDelete(setting.time_period_settings_id)} variant="destructive">{t('common:actions.delete')}</Button>
          </div>
        </>
      )}
    </div>
  );
};

export default TimePeriodSettings;
