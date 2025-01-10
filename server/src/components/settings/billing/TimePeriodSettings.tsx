'use client';
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Label } from '@/components/ui/Label';
import { Checkbox } from '@/components/ui/Checkbox';
import CustomSelect from '@/components/ui/CustomSelect';
import { ITimePeriodSettings } from '@/interfaces/timeEntry.interfaces';
import { getActiveTimePeriodSettings, updateTimePeriodSettings, createTimePeriodSettings, deleteTimePeriodSettings } from '@/lib/actions/time-period-settings-actions/timePeriodSettingsActions';
import { ISO8601String } from '@/types/types.d';
import { formatISO, parseISO } from 'date-fns';

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
    try {
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
    } catch (error) {
      console.error('Error adding time period setting:', error);
      setError('Failed to add time period setting');
    }
  };

  const handleUpdateSetting = async (updatedSetting: ITimePeriodSettings) => {
    try {
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

  if (isLoading) return <div>Loading...</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Time Period Settings</CardTitle>
        <CardDescription>Configure billing time period settings</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {settings.map((setting): JSX.Element => (
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
              onCancel={() => setShowNewSettingForm(false)}
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
}

const NewTimePeriodSettingForm: React.FC<NewTimePeriodSettingFormProps> = ({ newSetting, setNewSetting, onAdd, onCancel }) => {
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
    } else if (name === 'start_month' || name === 'end_month') {
      setNewSetting({ ...newSetting, [name]: parseInt(value, 10) });
    }
  };

  return (
    <div className="border p-4 rounded-md space-y-4">
      <div className="space-y-2">
        <Label htmlFor="frequency">Frequency</Label>
        <Input
          id="frequency"
          name="frequency"
          type="number"
          min={1}
          value={newSetting.frequency}
          onChange={handleInputChange}
        />
      </div>

      <div className="space-y-2">
        <Label>Frequency Unit</Label>
        <CustomSelect
          value={newSetting.frequency_unit}
          onValueChange={handleSelectChange('frequency_unit')}
          options={frequencyUnitOptions}
        />
      </div>

      {(newSetting.frequency_unit === 'week' || newSetting.frequency_unit === 'month') && (
        <>
          <div className="space-y-2">
            <Label htmlFor="start_day">Start Day</Label>
            <Input
              id="start_day"
              name="start_day"
              type="number"
              min={1}
              max={newSetting.frequency_unit === 'week' ? 7 : 31}
              value={newSetting.start_day}
              onChange={handleInputChange}
            />
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
                <Label htmlFor="end_day">End Day</Label>
                <Input
                  id="end_day"
                  name="end_day"
                  type="number"
                  min={1}
                  max={newSetting.frequency_unit === 'week' ? 7 : 31}
                  value={newSetting.end_day === END_OF_PERIOD ? '' : newSetting.end_day}
                  onChange={handleInputChange}
                />
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
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="start_day_of_month">Start Day of Month</Label>
            <Input
              id="start_day_of_month"
              name="start_day_of_month"
              type="number"
              min={1}
              max={31}
              value={newSetting.start_day_of_month}
              onChange={handleInputChange}
            />
          </div>

          <div className="space-y-2">
            <Label>End Month</Label>
            <CustomSelect
              value={(newSetting.end_month || 12).toString()}
              onValueChange={handleSelectChange('end_month')}
              options={monthOptions}
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
                <Label htmlFor="end_day_of_month">End Day of Month</Label>
                <Input
                  id="end_day_of_month"
                  name="end_day_of_month"
                  type="number"
                  min={1}
                  max={31}
                  value={newSetting.end_day_of_month === END_OF_PERIOD ? '' : newSetting.end_day_of_month}
                  onChange={handleInputChange}
                />
              </div>
            )}
          </div>
        </>
      )}

      <div className="space-x-2">
        <Button id="add-setting-button" onClick={onAdd}>Add Time Period Setting</Button>
        <Button id="cancel-add-button" onClick={onCancel} variant="outline">Cancel</Button>
      </div>
    </div>
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
    } else if (name === 'start_month' || name === 'end_month') {
      setEditedSetting({ ...editedSetting, [name]: parseInt(value, 10) });
    }
  };

  const handleSave = () => {
    onUpdate(editedSetting);
    setIsEditing(false);
  };

  const formatEndDay = (day: number | undefined, frequencyUnit: string): string => {
    if (day === END_OF_PERIOD) {
      return `End of ${frequencyUnit}`;
    }
    return day?.toString() || 'Not set';
  };

  return (
    <div className="border p-4 rounded-md">
      {isEditing ? (
        <>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="frequency">Frequency</Label>
              <Input
                id="frequency"
                name="frequency"
                type="number"
                min={1}
                value={editedSetting.frequency}
                onChange={handleInputChange}
              />
            </div>

            <div className="space-y-2">
              <Label>Frequency Unit</Label>
              <CustomSelect
                value={editedSetting.frequency_unit}
                onValueChange={handleSelectChange('frequency_unit')}
                options={frequencyUnitOptions}
              />
            </div>

            {(editedSetting.frequency_unit === 'week' || editedSetting.frequency_unit === 'month') && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="start_day">Start Day</Label>
                  <Input
                    id="start_day"
                    name="start_day"
                    type="number"
                    min={1}
                    max={editedSetting.frequency_unit === 'week' ? 7 : 31}
                    value={editedSetting.start_day}
                    onChange={handleInputChange}
                  />
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
                      <Label htmlFor="end_day">End Day</Label>
                      <Input
                        id="end_day"
                        name="end_day"
                        type="number"
                        min={1}
                        max={editedSetting.frequency_unit === 'week' ? 7 : 31}
                        value={editedSetting.end_day === END_OF_PERIOD ? '' : editedSetting.end_day}
                        onChange={handleInputChange}
                      />
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
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="start_day_of_month">Start Day of Month</Label>
                  <Input
                    id="start_day_of_month"
                    name="start_day_of_month"
                    type="number"
                    min={1}
                    max={31}
                    value={editedSetting.start_day_of_month}
                    onChange={handleInputChange}
                  />
                </div>

                <div className="space-y-2">
                  <Label>End Month</Label>
                  <CustomSelect
                    value={(editedSetting.end_month || 12).toString()}
                    onValueChange={handleSelectChange('end_month')}
                    options={monthOptions}
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
                      <Label htmlFor="end_day_of_month">End Day of Month</Label>
                      <Input
                        id="end_day_of_month"
                        name="end_day_of_month"
                        type="number"
                        min={1}
                        max={31}
                        value={editedSetting.end_day_of_month === END_OF_PERIOD ? '' : editedSetting.end_day_of_month}
                        onChange={handleInputChange}
                      />
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="space-x-2">
              <Button id="save-setting-button" onClick={handleSave}>Save</Button>
              <Button id="cancel-edit-button" onClick={() => setIsEditing(false)} variant="outline">Cancel</Button>
            </div>
          </div>
        </>
      ) : (
        <>
          <p>Frequency: {setting.frequency} {setting.frequency_unit}(s)</p>
          {(setting.frequency_unit === 'week' || setting.frequency_unit === 'month') && (
            <>
              <p>Start Day: {setting.start_day}</p>
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
