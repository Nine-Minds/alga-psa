'use client';

import React, { useState, useEffect } from 'react';
import { Switch } from 'server/src/components/ui/Switch';
import { Card, CardHeader, CardContent, CardTitle, CardFooter } from 'server/src/components/ui/Card';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Button } from 'server/src/components/ui/Button';
import { updateService } from 'server/src/lib/actions/serviceActions';
import { IService } from 'server/src/interfaces/billing.interfaces';
import { ITaxRegion } from 'server/src/interfaces/tax.interfaces'; // Changed ITaxRate to ITaxRegion
import { getActiveTaxRegions } from 'server/src/lib/actions/taxSettingsActions'; // Added

interface ServiceTaxSettingsProps {
  service: IService;
  // Removed taxRates prop, will fetch regions internally
  onUpdate?: () => void;
}

export function ServiceTaxSettings({ service, onUpdate }: ServiceTaxSettingsProps) { // Removed taxRates from props
  const [isTaxable, setIsTaxable] = useState(service.is_taxable ?? true); // Default to true if undefined
  const [regionCode, setRegionCode] = useState<string | null>(service.region_code || null); // Changed taxRegion to regionCode
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Removed effectiveTaxRate state
  const [taxRegions, setTaxRegions] = useState<Pick<ITaxRegion, 'region_code' | 'region_name'>[]>([]); // Added
  const [isLoadingTaxRegions, setIsLoadingTaxRegions] = useState(true); // Added
  const [errorTaxRegions, setErrorTaxRegions] = useState<string | null>(null); // Added

  // Fetch tax regions
  useEffect(() => {
      const fetchTaxRegions = async () => {
          try {
              setIsLoadingTaxRegions(true);
              const regions = await getActiveTaxRegions();
              setTaxRegions(regions);
              setErrorTaxRegions(null);
          } catch (error) {
              console.error('Error loading tax regions:', error);
              setErrorTaxRegions('Failed to load tax regions.');
              setTaxRegions([]);
          } finally {
              setIsLoadingTaxRegions(false);
          }
      };
      fetchTaxRegions();
  }, []);

  // Generate options from fetched tax regions
  const taxRegionOptions = taxRegions.map(region => ({
    value: region.region_code,
    label: region.region_name
  }));

  // Add an option to represent the company default (clearing the selection)
  const selectOptions = [
    { value: '', label: 'Use Company Default' },
    ...taxRegionOptions
  ];

  // Removed useEffect for effectiveTaxRate

  const handleTaxableChange = (checked: boolean) => {
    setIsTaxable(checked);
    if (!checked) {
      setRegionCode(null); // Use regionCode setter
    }
  };

  const handleRegionCodeChange = (value: string) => { // Renamed function
    setRegionCode(value || null); // Use regionCode setter
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setError(null);

      await updateService(service.service_id, {
        is_taxable: isTaxable,
        region_code: regionCode // Changed tax_region to region_code
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
                label="Tax Region (Optional)"
                options={selectOptions}
                value={regionCode || ''} // Use regionCode state
                onValueChange={handleRegionCodeChange} // Use renamed handler
                placeholder={isLoadingTaxRegions ? "Loading regions..." : "Use Company Default"}
                disabled={isSaving || isLoadingTaxRegions} // Disable while saving or loading
                allowClear={true} // Use allowClear built into CustomSelect
            />
          </div>
        )}

        {/* Removed display of effectiveTaxRate */}

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