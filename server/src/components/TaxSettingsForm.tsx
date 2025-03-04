import React, { useState, useEffect } from 'react';
import { getCompanyTaxSettings, updateCompanyTaxSettings, getTaxRates, createDefaultTaxSettings } from '../lib/actions/taxSettingsActions';
import { ICompanyTaxSettings, ITaxRate, ITaxComponent, ITaxRateThreshold, ITaxHoliday } from '../interfaces/tax.interfaces';
import CustomSelect from 'server/src/components/ui/CustomSelect';

interface TaxSettingsFormProps {
  companyId: string;
}

const TaxSettingsForm: React.FC<TaxSettingsFormProps> = ({ companyId }) => {
  const [taxSettings, setTaxSettings] = useState<Omit<ICompanyTaxSettings, 'tenant'> | null>(null);
  const [taxRates, setTaxRates] = useState<ITaxRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const settings = await getCompanyTaxSettings(companyId);
        const rates = await getTaxRates();
        setTaxSettings(settings);
        setTaxRates(rates);
        setLoading(false);
      } catch (err) {
        if (err instanceof Error && err.message === 'No tax settings found') {
          setTaxSettings(null);
        } else {
          setError('Error fetching tax settings');
        }
        setLoading(false);
      }
    };

    fetchData();
  }, [companyId]);

  // Handle creation of default tax settings when none exist
  const handleCreateDefaultSettings = async () => {
    try {
      setLoading(true);
      const defaultSettings = await createDefaultTaxSettings(companyId);
      setTaxSettings(defaultSettings);
      setError(null);
      setSuccessMessage('Default tax settings created successfully');
      setLoading(false);
    } catch (err) {
      setError('Error creating default tax settings');
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taxSettings) return;

    try {
      const updatedSettings = await updateCompanyTaxSettings(companyId, taxSettings);
      setTaxSettings(updatedSettings);
      setError(null);
      setSuccessMessage('Tax settings updated successfully');
    } catch (err) {
      setError('Error updating tax settings');
    }
  };

  const handleTaxRateChange = (taxRateId: string) => {
    const selectedTaxRate = taxRates.find(rate => rate.tax_rate_id === taxRateId);
    if (selectedTaxRate && taxSettings) {
      setTaxSettings({
        ...taxSettings,
        tax_rate_id: taxRateId,
      });
    }
  };

  const handleComponentChange = (index: number, field: keyof ITaxComponent, value: any) => {
    if (taxSettings && taxSettings.tax_components) {
      const updatedComponents = [...taxSettings.tax_components];
      updatedComponents[index] = { ...updatedComponents[index], [field]: value };
      setTaxSettings({ ...taxSettings, tax_components: updatedComponents });
    }
  };

  const handleThresholdChange = (index: number, field: keyof ITaxRateThreshold, value: any) => {
    if (taxSettings && taxSettings.tax_rate_thresholds) {
      const updatedThresholds = [...taxSettings.tax_rate_thresholds];
      updatedThresholds[index] = { ...updatedThresholds[index], [field]: value };
      setTaxSettings({ ...taxSettings, tax_rate_thresholds: updatedThresholds });
    }
  };

  const handleHolidayChange = (index: number, field: keyof ITaxHoliday, value: any) => {
    if (taxSettings && taxSettings.tax_holidays) {
      const updatedHolidays = [...taxSettings.tax_holidays];
      updatedHolidays[index] = { ...updatedHolidays[index], [field]: value };
      setTaxSettings({ ...taxSettings, tax_holidays: updatedHolidays });
    }
  };

  const addComponent = () => {
    if (taxSettings) {
      const newComponent: Omit<ITaxComponent, 'tenant'> = {
        tax_component_id: '',
        tax_rate_id: taxSettings.tax_rate_id,
        name: '',
        rate: 0,
        sequence: (taxSettings.tax_components?.length || 0) + 1,
        is_compound: false,
      };

      const tax_components: ITaxComponent[] = (taxSettings.tax_components || []).map((component: Omit<ITaxComponent, 'tenant'>): ITaxComponent => ({
        ...component,
        tenant: ''
      }));
      const newComponentWithTenant: ITaxComponent = {
        ...newComponent,
        tenant: ''
        };
      tax_components.push(newComponentWithTenant);
      
      setTaxSettings({
        ...taxSettings,
        tax_components: tax_components,
      });
    }
  };


  const addThreshold = () => {
    if (taxSettings) {
      const newThreshold: Omit<ITaxRateThreshold, 'tenant'> = {
        tax_rate_threshold_id: '',
        tax_rate_id: taxSettings.tax_rate_id,
        min_amount: 0,
        max_amount: 0,
        rate: 0,
      };
  
      const tax_rate_thresholds: ITaxRateThreshold[] = (taxSettings.tax_rate_thresholds || []).map((threshold: Omit<ITaxRateThreshold, 'tenant'>): ITaxRateThreshold => ({
        ...threshold,
        tenant: ''
      }));
      const newThresholdWithTenant: ITaxRateThreshold = {
        ...newThreshold,
        tenant: ''
      };
      tax_rate_thresholds.push(newThresholdWithTenant);
  
      setTaxSettings({
        ...taxSettings,
        tax_rate_thresholds: tax_rate_thresholds,
      });
    }
  };
  
  const addHoliday = () => {
    if (taxSettings) {
      const newHoliday: Omit<ITaxHoliday, 'tenant'> = {
        tax_holiday_id: '',
        tax_component_id: '', // This should be set to a valid component ID
        start_date: new Date().toISOString().split('T')[0],
        end_date: new Date().toISOString().split('T')[0],
        description: '',
      };
  
      const tax_holidays: ITaxHoliday[] = (taxSettings.tax_holidays || []).map((holiday: Omit<ITaxHoliday, 'tenant'>): ITaxHoliday => ({
        ...holiday,
        tenant: ''
      }));
      const newHolidayWithTenant: ITaxHoliday = {
        ...newHoliday,
        tenant: ''
      };
      tax_holidays.push(newHolidayWithTenant);
  
      setTaxSettings({
        ...taxSettings,
        tax_holidays: tax_holidays,
      });
    }
  };
  const removeComponent = (index: number) => {
    if (taxSettings && taxSettings.tax_components) {
      const updatedComponents = taxSettings.tax_components.filter((_, i) => i !== index);
      setTaxSettings({ ...taxSettings, tax_components: updatedComponents });
    }
  };

  const removeThreshold = (index: number) => {
    if (taxSettings && taxSettings.tax_rate_thresholds) {
      const updatedThresholds = taxSettings.tax_rate_thresholds.filter((_, i) => i !== index);
      setTaxSettings({ ...taxSettings, tax_rate_thresholds: updatedThresholds });
    }
  };

  const removeHoliday = (index: number) => {
    if (taxSettings && taxSettings.tax_holidays) {
      const updatedHolidays = taxSettings.tax_holidays.filter((_, i) => i !== index);
      setTaxSettings({ ...taxSettings, tax_holidays: updatedHolidays });
    }
  };

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;
  if (successMessage) return <div className="text-green-600">{successMessage}</div>;
  if (!taxSettings) {
    return (
      <div className="text-center">
        <p className="mb-4">No tax settings found for this company.</p>
        <button
          onClick={handleCreateDefaultSettings}
          className="px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          Create Default Tax Settings
        </button>
      </div>
    );
  }

  const taxRateOptions = taxRates.map((rate): { value: string; label: string } => ({
    value: rate.tax_rate_id,
    label: `${rate.name} (${rate.tax_percentage}%)`
  }));

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <h2 className="text-2xl font-bold">Company Tax Settings</h2>
      <div>
        <div className="inline-block">
          <CustomSelect
            label="Tax Rate"
            value={taxSettings.tax_rate_id}
            onValueChange={handleTaxRateChange}
            options={taxRateOptions}
            placeholder="Select Tax Rate"
          />
        </div>
      </div>
      <div>
        <label htmlFor="reverseCharge" className="flex items-center">
          <input
            type="checkbox"
            id="reverseCharge"
            checked={taxSettings.is_reverse_charge_applicable}
            onChange={(e) =>
              setTaxSettings({ ...taxSettings, is_reverse_charge_applicable: e.target.checked })
            }
            className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
          />
          <span className="ml-2 text-sm text-gray-700">Apply Reverse Charge</span>
        </label>
      </div>

      { /*
      {taxSettings.is_composite && (
        <div>
          <h3 className="text-lg font-medium text-gray-900">Composite Tax Components</h3>
          {taxSettings.tax_components?.map((component, index) => (
            <div key={index} className="mt-4 space-y-2">
              <input
                type="text"
                value={component.name}
                onChange={(e) => handleComponentChange(index, 'name', e.target.value)}
                placeholder="Component Name"
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              />
              <input
                type="number"
                value={component.rate}
                onChange={(e) => handleComponentChange(index, 'rate', parseFloat(e.target.value))}
                placeholder="Rate"
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              />
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={component.is_compound}
                  onChange={(e) => handleComponentChange(index, 'is_compound', e.target.checked)}
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                />
                <span className="ml-2 text-sm text-gray-700">Is Compound</span>
              </label>
              <button
                type="button"
                onClick={() => removeComponent(index)}
                className="mt-2 px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
              >
                Remove Component
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addComponent}
            className="mt-4 px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            Add Component
          </button>
        </div>
      )} */ }

      <div>
        <h3 className="text-lg font-medium text-gray-900">Tax Rate Thresholds</h3>
        {taxSettings.tax_rate_thresholds?.map((threshold, index): JSX.Element => (
          <div key={index} className="mt-4 space-y-2">
            <input
              type="number"
              value={threshold.min_amount}
              onChange={(e) => handleThresholdChange(index, 'min_amount', parseFloat(e.target.value))}
              placeholder="Min Amount"
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            />
            <input
              type="number"
              value={threshold.max_amount}
              onChange={(e) => handleThresholdChange(index, 'max_amount', parseFloat(e.target.value))}
              placeholder="Max Amount"
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            />
            <input
              type="number"
              value={threshold.rate}
              onChange={(e) => handleThresholdChange(index, 'rate', parseFloat(e.target.value))}
              placeholder="Rate"
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            />
            <button
              type="button"
              onClick={() => removeThreshold(index)}
              className="mt-2 px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            >
              Remove Threshold
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addThreshold}
          className="mt-4 px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          Add Threshold
        </button>
      </div>

      <div>
        <h3 className="text-lg font-medium text-gray-900">Tax Holidays</h3>
        {taxSettings.tax_holidays?.map((holiday, index): JSX.Element => (
          <div key={index} className="mt-4 space-y-2">
            <input
              type="date"
              value={holiday.start_date}
              onChange={(e) => handleHolidayChange(index, 'start_date', e.target.value)}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            />
            <input
              type="date"
              value={holiday.end_date}
              onChange={(e) => handleHolidayChange(index, 'end_date', e.target.value)}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            />
            <input
              type="text"
              value={holiday.description}
              onChange={(e) => handleHolidayChange(index, 'description', e.target.value)}
              placeholder="Description"
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            />
            <button
              type="button"
              onClick={() => removeHoliday(index)}
              className="mt-2 px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            >
              Remove Holiday
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addHoliday}
          className="mt-4 px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          Add Holiday
        </button>
      </div>

      <button
        type="submit"
        className="w-full px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
      >
        Update Tax Settings
      </button>
    </form>
  );
};

export default TaxSettingsForm;
