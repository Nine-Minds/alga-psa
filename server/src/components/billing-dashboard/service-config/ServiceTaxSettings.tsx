'use client';

import React, { useState, useEffect } from 'react';
import { Switch } from 'server/src/components/ui/Switch';
import { Card, CardHeader, CardContent, CardTitle, CardFooter } from 'server/src/components/ui/Card';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Button } from 'server/src/components/ui/Button';
import { updateService } from 'server/src/lib/actions/serviceActions';
import { IService } from 'server/src/interfaces/billing.interfaces';
import { ITaxRate } from 'server/src/interfaces/tax.interfaces';

interface ServiceTaxSettingsProps {
  service: IService;
  taxRates?: ITaxRate[];
  onUpdate?: () => void;
}

export function ServiceTaxSettings({ service, taxRates = [], onUpdate }: ServiceTaxSettingsProps) {
  const [isTaxable, setIsTaxable] = useState(service.is_taxable || false);
  const [taxRegion, setTaxRegion] = useState<string | null>(service.tax_region || null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [effectiveTaxRate, setEffectiveTaxRate] = useState<number | null>(null);

  // Convert tax rates to options for the select component
  const taxRegionOptions = taxRates.map(rate => ({
    value: rate.tax_rate_id,
    label: `${rate.name} (${rate.country_code}) - ${rate.tax_percentage}%`
  }));

  // Add a "None" option
  const selectOptions = [
    { value: '', label: 'None' },
    ...taxRegionOptions
  ];

  // Update effective tax rate when tax region changes
  useEffect(() => {
    if (isTaxable && taxRegion) {
      const selectedRate = taxRates.find(rate => rate.tax_rate_id === taxRegion);
      if (selectedRate) {
        setEffectiveTaxRate(selectedRate.tax_percentage);
      } else {
        setEffectiveTaxRate(null);
      }
    } else {
      setEffectiveTaxRate(null);
    }
  }, [isTaxable, taxRegion, taxRates]);

  const handleTaxableChange = (checked: boolean) => {
    setIsTaxable(checked);
    if (!checked) {
      setTaxRegion(null);
    }
  };

  const handleTaxRegionChange = (value: string) => {
    setTaxRegion(value || null);
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setError(null);

      await updateService(service.service_id, {
        is_taxable: isTaxable,
        tax_region: taxRegion
      } as Partial<IService>);

      if (onUpdate) {
        onUpdate();
      }
    } catch (err) {
      console.error('Error updating tax settings:', err);
      setError('Failed to save tax settings');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Tax Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Switch 
            id="service-taxable-switch"
            label="Taxable Service" 
            checked={isTaxable} 
            onCheckedChange={handleTaxableChange}
            disabled={isSaving}
          />
        </div>

        {isTaxable && (
          <div className="mt-4">
            <CustomSelect
              id="tax-region-select"
              label="Tax Region"
              options={selectOptions}
              value={taxRegion || ''}
              onValueChange={handleTaxRegionChange}
              placeholder="Select tax region"
              disabled={isSaving}
            />
          </div>
        )}

        {isTaxable && effectiveTaxRate !== null && (
          <div className="mt-2 p-3 bg-gray-50 rounded-md">
            <p className="text-sm font-medium">Effective Tax Rate: {effectiveTaxRate}%</p>
          </div>
        )}

        {error && <p className="text-red-500 text-sm">{error}</p>}
      </CardContent>
      <CardFooter className="flex justify-end">
        <Button 
          id="save-tax-settings-button"
          onClick={handleSave} 
          disabled={isSaving}
        >
          {isSaving ? 'Saving...' : 'Save Tax Settings'}
        </Button>
      </CardFooter>
    </Card>
  );
}