import React, { useState, useEffect } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { addTaxRate } from 'server/src/lib/actions/taxRateActions';
import { getActiveTaxRegions } from 'server/src/lib/actions/taxSettingsActions';
import { ITaxRegion } from 'server/src/interfaces/tax.interfaces';
import { toast } from 'react-hot-toast';

interface TaxRateCreateFormProps {
    onSuccess: () => Promise<void>; // Callback on successful creation
    onError: (error: Error) => void; // Callback on error
}

const TaxRateCreateForm: React.FC<TaxRateCreateFormProps> = ({ onSuccess, onError }) => {
    const [regionCode, setRegionCode] = useState('');
    const [percentage, setPercentage] = useState(''); // Store as string for input flexibility
    const [description, setDescription] = useState('');
    const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]); // Default to today
    const [endDate, setEndDate] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [validationError, setValidationError] = useState<string | null>(null);
    
    // Tax regions state
    const [taxRegions, setTaxRegions] = useState<Pick<ITaxRegion, 'region_code' | 'region_name'>[]>([]);
    const [isLoadingTaxRegions, setIsLoadingTaxRegions] = useState(true);
    const [errorTaxRegions, setErrorTaxRegions] = useState<string | null>(null);
    
    // Fetch tax regions on component mount
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

    const validateForm = (): boolean => {
        if (!regionCode) {
            setValidationError('Tax region is required.');
            return false;
        }
        
        const percValue = parseFloat(percentage);
        if (isNaN(percValue) || percValue <= 0 || percValue > 100) {
            setValidationError('Percentage must be a valid number between 0 and 100.');
            return false;
        }
        
        if (!startDate) {
            setValidationError('Start date is required.');
            return false;
        }
        
        // Description is optional
        // End date is optional
        
        setValidationError(null);
        return true;
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!validateForm()) {
            return;
        }

        setIsSubmitting(true);
        try {
            const percentageValue = parseFloat(percentage); // Already validated
            
            await addTaxRate({
                region_code: regionCode,
                tax_percentage: percentageValue,
                description: description.trim() || undefined,
                start_date: startDate,
                end_date: endDate || null
            });
            await onSuccess(); // Call parent success handler
        } catch (error) {
            onError(error instanceof Error ? error : new Error('An unknown error occurred'));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="px-4 space-y-4">
            {(validationError || errorTaxRegions) && (
                <p className="text-red-600 text-sm">{validationError || errorTaxRegions}</p>
            )}
            <div>
                <Label htmlFor="tax-rate-region">Tax Region</Label>
                <CustomSelect
                    id="tax-rate-region"
                    value={regionCode}
                    onValueChange={(value) => {
                        setRegionCode(value);
                        setValidationError(null);
                    }}
                    options={taxRegions.map(r => ({ value: r.region_code, label: r.region_name }))}
                    placeholder={isLoadingTaxRegions ? "Loading regions..." : "Select Tax Region"}
                    disabled={isSubmitting || isLoadingTaxRegions}
                    required={true}
                />
            </div>
            <div>
                <Label htmlFor="tax-rate-percentage">Percentage (%)</Label>
                <Input
                    id="tax-rate-percentage"
                    type="number"
                    step="0.01" // Allow decimals
                    value={percentage}
                    onChange={(e) => {
                        setPercentage(e.target.value);
                        setValidationError(null);
                    }}
                    placeholder="e.g., 8.25"
                    disabled={isSubmitting}
                    required
                />
            </div>
            <div>
                <Label htmlFor="tax-rate-description">Description (Optional)</Label>
                <Input
                    id="tax-rate-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g., California State Tax"
                    disabled={isSubmitting}
                />
            </div>
            <div>
                <Label htmlFor="tax-rate-start-date">Start Date</Label>
                <Input
                    id="tax-rate-start-date"
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                        setStartDate(e.target.value);
                        setValidationError(null);
                    }}
                    disabled={isSubmitting}
                    required
                />
            </div>
            <div>
                <Label htmlFor="tax-rate-end-date">End Date (Optional)</Label>
                <Input
                    id="tax-rate-end-date"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    disabled={isSubmitting}
                />
            </div>
            {/* Footer using standard div */}
            <div className="flex justify-end gap-2 pt-4">
                {/* Use a standard button for Cancel, Drawer closes via onOpenChange prop in parent */}
                {/* We need a way to trigger the close from here. A simple approach is to simulate clicking the built-in close button if available, or rely on the parent managing the open state */}
                <Button id="cancel-create-tax-rate-button" type="button" variant="ghost" onClick={() => {
                    // Attempt to find and click the Drawer's default close button
                    const closeButton = document.querySelector('button[aria-label="Close"]') as HTMLElement | null;
                    closeButton?.click();
                    // If that doesn't work, the parent's onOpenChange(false) should handle it
                }} disabled={isSubmitting}>Cancel</Button>
                <Button id="submit-create-tax-rate-button" type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Creating...' : 'Create Tax Rate'}
                </Button>
            </div>
        </form>
    );
};

export default TaxRateCreateForm;