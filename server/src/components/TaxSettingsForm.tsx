import React, { useState, useEffect } from 'react';
import { getCompanyTaxSettings, updateCompanyTaxSettings, getTaxRates, createDefaultTaxSettings } from '../lib/actions/taxSettingsActions';
import { ICompanyTaxSettings, ITaxRate, ITaxComponent, ITaxRateThreshold, ITaxHoliday } from '../interfaces/tax.interfaces';
import CustomSelect from 'server/src/components/ui/CustomSelect';

interface TaxSettingsFormProps {
  companyId: string;
}

const TaxSettingsForm: React.FC<TaxSettingsFormProps> = ({ companyId }) => {
  const [taxSettings, setTaxSettings] = useState<Omit<ICompanyTaxSettings, 'tenant'> | null>(null);
  const [originalSettings, setOriginalSettings] = useState<Omit<ICompanyTaxSettings, 'tenant'> | null>(null);
  const [taxRates, setTaxRates] = useState<ITaxRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const settings = await getCompanyTaxSettings(companyId);
        const rates = await getTaxRates();
        setTaxSettings(settings);
        // Store original settings for reverting on error
        setOriginalSettings(JSON.parse(JSON.stringify(settings)));
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

  // Dismiss error message
  const dismissError = () => {
    setError(null);
  };

  // Validate tax settings before submission
  const validateTaxSettings = (settings: Omit<ICompanyTaxSettings, 'tenant'>): string | null => {
   // Removed validation for tax_rate_id as it's no longer part of settings

    // Validate tax rate thresholds
    if (settings.tax_rate_thresholds && settings.tax_rate_thresholds.length > 0) {
      for (let i = 0; i < settings.tax_rate_thresholds.length; i++) {
        const threshold = settings.tax_rate_thresholds[i];
        if (threshold.min_amount < 0) {
          return `Threshold ${i + 1} has a negative minimum amount`;
        }
        if (threshold.max_amount !== undefined && threshold.max_amount < threshold.min_amount) {
          return `Threshold ${i + 1} has a maximum amount less than its minimum amount`;
        }
        if (threshold.rate < 0) {
          return `Threshold ${i + 1} has a negative rate`;
        }
      }
    }

    // Validate tax holidays
    if (settings.tax_holidays && settings.tax_holidays.length > 0) {
      for (let i = 0; i < settings.tax_holidays.length; i++) {
        const holiday = settings.tax_holidays[i];
        if (!holiday.start_date || !holiday.end_date) {
          return `Holiday ${i + 1} is missing start or end date`;
        }
        if (new Date(holiday.start_date) > new Date(holiday.end_date)) {
          return `Holiday ${i + 1} has an end date before its start date`;
        }
      }
    }

    return null;
  };

  // Dismiss success message
  const dismissSuccess = () => {
    setSuccessMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taxSettings) return;

    // Validate tax settings before submission
    const validationError = validateTaxSettings(taxSettings);
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    try {
      const updatedSettings = await updateCompanyTaxSettings(companyId, taxSettings);
      setTaxSettings(updatedSettings);
      // Update original settings after successful update
      setOriginalSettings(JSON.parse(JSON.stringify(updatedSettings)));
      setError(null);
      setSuccessMessage('Tax settings updated successfully');
    } catch (err) {
      // Revert to original settings on error
      if (originalSettings) {
        setTaxSettings(JSON.parse(JSON.stringify(originalSettings)));
      }
      setError(err instanceof Error ? err.message : 'Error updating tax settings');
    } finally {
      setIsSubmitting(false);
    }
  };

 // Removed handleTaxRateChange as tax_rate_id is no longer managed here

 // Removed handlers for components, thresholds, and holidays as these sections are removed

  if (loading) return <div>Loading...</div>;

  // Dismissible error message
  const ErrorMessage = () => {
    if (!error) return null;
    return (
      <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-4">
        <div className="flex items-start">
          <div className="flex-1">
            <p className="text-red-700">{error}</p>
          </div>
          <button
            onClick={dismissError}
            className="ml-4 text-red-500 hover:text-red-700"
            aria-label="Dismiss error"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>
    );
  };

  // Dismissible success message
  const SuccessMessage = () => {
    if (!successMessage) return null;
    return (
      <div className="bg-green-50 border-l-4 border-green-500 p-4 mb-4">
        <div className="flex items-start">
          <div className="flex-1">
            <p className="text-green-700">{successMessage}</p>
          </div>
          <button
            onClick={dismissSuccess}
            className="ml-4 text-green-500 hover:text-green-700"
            aria-label="Dismiss success message"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>
    );
  };
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

 // Removed taxRateOptions as the select dropdown is removed

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <h2 className="text-2xl font-bold">Company Tax Settings</h2>
      <ErrorMessage />
      <SuccessMessage />
     {/* Removed Tax Rate selection dropdown as tax_rate_id is no longer on company_tax_settings */}
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

     {/* Removed UI sections for Tax Components, Thresholds, and Holidays */}

      <div className="flex justify-between">
        <button
          type="button"
          onClick={() => {
            if (originalSettings) {
              setTaxSettings(JSON.parse(JSON.stringify(originalSettings)));
              setError(null);
            }
          }}
          className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          disabled={isSubmitting}
        >
          Reset Changes
        </button>
        <button
          type="submit"
          className="px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Updating...' : 'Update Tax Settings'}
        </button>
      </div>
    </form>
  );
};

export default TaxSettingsForm;
