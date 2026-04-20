'use client'

import React, { useState, useEffect } from 'react'
import { Button } from '@alga-psa/ui/components/Button'
import { Input } from '@alga-psa/ui/components/Input'
import CustomSelect from '@alga-psa/ui/components/CustomSelect'
import { createService, getServiceTypesForSelection, getDefaultBillingSettings } from '@alga-psa/billing/actions'
import { getActiveTaxRegions, getTaxRates } from '@alga-psa/billing/actions/taxSettingsActions'; // Added getTaxRates
import { ITaxRate, ITaxRegion } from '@alga-psa/types';
import { UnitOfMeasureInput } from '@alga-psa/ui/components/UnitOfMeasureInput';
import { getErrorMessage, handleError, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export const ServiceForm: React.FC = () => {
  const { t } = useTranslation('msp/service-catalog');
  const [defaultCurrency, setDefaultCurrency] = useState('USD');
  const [serviceName, setServiceName] = useState('')
  const [serviceTypeId, setServiceTypeId] = useState<string>('') // Store the selected service type ID
  const [defaultRate, setDefaultRate] = useState('')
  const [unitOfMeasure, setUnitOfMeasure] = useState('')
  const [billingMethod, setBillingMethod] = useState<'fixed' | 'hourly' | 'usage'>('fixed')
  const [description, setDescription] = useState('')
  const [serviceTypes, setServiceTypes] = useState<{ id: string; name: string; billing_method: 'fixed' | 'hourly' | 'usage'; is_standard: boolean }[]>([])
  const [error, setError] = useState<string | null>(null)
  // Removed regionCode state and related hooks
  // Assuming tax_rate_id is handled by a dedicated component or passed in props now
  const [taxRateId, setTaxRateId] = useState<string | null>(null); // Placeholder for tax_rate_id state
  const [taxRates, setTaxRates] = useState<ITaxRate[]>([]);
  const [taxRegions, setTaxRegions] = useState<Pick<ITaxRegion, 'region_code' | 'region_name'>[]>([]);
  const [isLoadingTaxData, setIsLoadingTaxData] = useState(true); // Combined loading state
  const [errorTaxData, setErrorTaxData] = useState<string | null>(null); // Combined error state
  useEffect(() => {
    const fetchServiceTypes = async () => {
      try {
        const types = await getServiceTypesForSelection()
        setServiceTypes(types)
      } catch (error) {
        console.error('Error fetching service types:', error)
        setError(t('serviceForm.errors.loadServiceTypes', { defaultValue: 'Failed to fetch service types' }))
      }
    }
    getDefaultBillingSettings()
      .then((settings) => setDefaultCurrency(settings.defaultCurrencyCode || 'USD'))
      .catch(() => {});
    const fetchTaxData = async () => {
      setIsLoadingTaxData(true);
      setErrorTaxData(null);
      try {
        // Fetch both rates and regions concurrently
        const [rates, regions] = await Promise.all([
          getTaxRates(), // Use the imported function
          getActiveTaxRegions() // Use the imported function
        ]);
        setTaxRates(rates);
        setTaxRegions(regions);
      } catch (err) {
        const errorMessage = err instanceof Error
          ? err.message
          : t('serviceForm.errors.loadTaxData', { defaultValue: 'Failed to load tax data.' });
        setErrorTaxData(errorMessage);
        handleError(err, t('serviceForm.errors.loadTaxData', { defaultValue: 'Failed to load tax data.' }));
      } finally {
        setIsLoadingTaxData(false);
      }
    };

    fetchServiceTypes();
    fetchTaxData();
  }, [t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!serviceTypeId) {
      setError(t('serviceForm.errors.selectServiceType', { defaultValue: 'Please select a service type' }))
      return
    }

    try {
      // Find the selected service type to determine if it's standard or custom
      const selectedServiceType = serviceTypes.find(t => t.id === serviceTypeId)

      if (!selectedServiceType) {
        setError(t('serviceForm.errors.serviceTypeNotFound', { defaultValue: 'Selected service type not found' }))
        return
      }

      // Create base data
      const baseData = {
        service_name: serviceName,
        default_rate: parseFloat(defaultRate) || 0,
        currency_code: defaultCurrency,
        unit_of_measure: unitOfMeasure,
        category_id: null,
        billing_method: billingMethod,
        description: description,
        tax_rate_id: taxRateId // Use tax_rate_id instead
      }

      // Create the final data with the service type ID
      const submitData = {
        ...baseData,
        custom_service_type_id: serviceTypeId,
      }

      const result = await createService(submitData)
      if (isActionPermissionError(result)) {
        handleError(result.permissionError);
        return;
      }
      if (isActionMessageError(result)) {
        setError(getErrorMessage(result))
        return
      }
      setError(null)
      // Clear form fields after successful submission
      setServiceName('')
      setServiceTypeId('')
      setDefaultRate('')
      setUnitOfMeasure('')
      setBillingMethod('fixed')
      setDescription('')
      setTaxRateId(null); // Clear tax rate ID
    } catch (error) {
      console.error('Error creating service:', error)
      setError(
        error instanceof Error
          ? error.message
          : t('serviceForm.errors.create', { defaultValue: 'Failed to create service' }),
      ); // Show specific error
    }
  }

  // Create a map for quick region lookup
  const regionMap = new Map(taxRegions.map(r => [r.region_code, r.region_name]));

  // Define tax rate options based on fetched taxRates and taxRegions state
  const taxRateOptions = taxRates.map(rate => {
    const regionName = rate.country_code ? regionMap.get(rate.country_code) : undefined;
    // Use region name if found, otherwise fallback to tax_type or country_code
    const descriptionPart = regionName || rate.tax_type || rate.country_code || t('serviceForm.taxRateOption.fallback', { defaultValue: 'N/A' });
    const percentagePart = rate.tax_percentage.toFixed(2); // tax_percentage is number
    return {
      value: rate.tax_rate_id,
      label: t('serviceForm.taxRateOption.label', {
        description: descriptionPart,
        percentage: percentagePart,
        defaultValue: '{{description}} - {{percentage}}%',
      })
    };
  });

  const billingMethodOptions = [
    {
      value: 'fixed',
      label: t('serviceForm.options.billingMethod.fixed', { defaultValue: 'Fixed Price' }),
    },
    {
      value: 'hourly',
      label: t('serviceForm.options.billingMethod.hourly', { defaultValue: 'Hourly' }),
    },
    {
      value: 'usage',
      label: t('serviceForm.options.billingMethod.usage', { defaultValue: 'Usage Based' }),
    },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="text-red-500 mb-4">{error}</div>}
      {errorTaxData && <div className="text-red-500 mb-4">{errorTaxData}</div>} {/* Show combined tax data loading error */}
      <Input
        value={serviceName}
        onChange={(e) => setServiceName(e.target.value)}
        placeholder={t('serviceForm.fields.serviceName.placeholder', { defaultValue: 'Service Name' })}
        required
      />

      <CustomSelect
        label={t('serviceForm.fields.serviceType.label', { defaultValue: 'Service Type' })}
        options={serviceTypes.map(type => ({ value: type.id, label: type.name }))}
        value={serviceTypeId}
        onValueChange={(value) => {
          setServiceTypeId(value)
        }}
        placeholder={t('serviceForm.fields.serviceType.placeholder', { defaultValue: 'Select Service Type' })}
      />

      <CustomSelect
        label={t('serviceForm.fields.billingMethod.label', { defaultValue: 'Billing Method' })}
        options={billingMethodOptions}
        value={billingMethod}
        onValueChange={(value) => setBillingMethod(value as 'fixed' | 'hourly' | 'usage')}
        placeholder={t('serviceForm.fields.billingMethod.placeholder', { defaultValue: 'Select Billing Method' })}
      />

      <Input
        type="number"
        value={defaultRate}
        onChange={(e) => setDefaultRate(e.target.value)}
        placeholder={t('serviceForm.fields.defaultRate.placeholder', { defaultValue: 'Default Rate' })}
        required
      />

      <UnitOfMeasureInput
        value={unitOfMeasure}
        onChange={(value) => setUnitOfMeasure(value)}
        placeholder={t('serviceForm.fields.unitOfMeasure.placeholder', { defaultValue: 'Unit of Measure' })}
        className="w-full"
        required
      />

      <div>
        <label htmlFor="description" className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
          {t('serviceForm.fields.description.label', { defaultValue: 'Description' })}
        </label>
        <Input
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('serviceForm.fields.description.placeholder', { defaultValue: 'Service Description' })}
        />
      </div>

      {/* Added Tax Region Dropdown */}
      <div className="space-y-2">
        {/* Replace region select with tax rate select */}
        <CustomSelect
          label={t('serviceForm.fields.taxRate.label', { defaultValue: 'Tax Rate' })}
          id="service-tax-rate-field"
          value={taxRateId || ''}
          onValueChange={(value) => setTaxRateId(value || null)}
          options={taxRateOptions} // Use tax rate options
          placeholder={
            isLoadingTaxData
              ? t('serviceForm.fields.taxRate.placeholderLoading', { defaultValue: 'Loading tax data...' })
              : t('serviceForm.fields.taxRate.placeholder', { defaultValue: 'Select Tax Rate (Optional)' })
          }
          disabled={isLoadingTaxData}
        />
      </div>

      <Button id='add-service-button' type="submit">
        {t('serviceForm.actions.submit', { defaultValue: 'Add Service' })}
      </Button>
    </form>
  )
}
