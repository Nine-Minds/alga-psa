import React, { useState, useEffect } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
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
    const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
    const [validationErrors, setValidationErrors] = useState<string[]>([]);
    
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

    const validateForm = () => {
        const validationErrors: string[] = [];

        // Validate tax region
        if (!regionCode || regionCode.trim() === '') {
            validationErrors.push('Tax region is required');
        }

        // Validate percentage
        const percValue = parseFloat(percentage);
        if (!percentage.trim()) {
            validationErrors.push('Tax percentage is required');
        } else if (isNaN(percValue)) {
            validationErrors.push('Tax percentage must be a valid number');
        } else if (percValue < 0) {
            validationErrors.push('Tax percentage cannot be negative');
        } else if (percValue > 100) {
            validationErrors.push('Tax percentage cannot exceed 100%');
        }

        // Validate start date
        if (!startDate || startDate.trim() === '') {
            validationErrors.push('Start date is required');
        } else {
            const startDateObj = new Date(startDate);
            if (isNaN(startDateObj.getTime())) {
                validationErrors.push('Start date must be a valid date');
            }
        }

        // Validate end date if provided
        if (endDate && endDate.trim() !== '') {
            const endDateObj = new Date(endDate);
            const startDateObj = new Date(startDate);

            if (isNaN(endDateObj.getTime())) {
                validationErrors.push('End date must be a valid date');
            } else if (startDate && endDateObj <= startDateObj) {
                validationErrors.push('End date must be after start date');
            }
        }

        // Validate description length
        if (description && description.trim().length > 255) {
            validationErrors.push('Description cannot exceed 255 characters');
        }

        return validationErrors;
    };

    const clearErrorIfSubmitted = () => {
        if (hasAttemptedSubmit) {
            setValidationErrors([]);
        }
    };

    // Clear specific validation errors as user types
    const handleRegionCodeChange = (value: string) => {
        setRegionCode(value);
        if (hasAttemptedSubmit && value.trim() !== '') {
            setValidationErrors(prev => prev.filter(error => !error.includes('Tax region')));
        }
    };

    const handlePercentageChange = (value: string) => {
        setPercentage(value);
        if (hasAttemptedSubmit && value.trim() !== '') {
            const percValue = parseFloat(value);
            if (!isNaN(percValue) && percValue >= 0 && percValue <= 100) {
                setValidationErrors(prev => prev.filter(error => !error.includes('percentage')));
            }
        }
    };

    const handleDescriptionChange = (value: string) => {
        setDescription(value);
        if (hasAttemptedSubmit && value.trim().length <= 255) {
            setValidationErrors(prev => prev.filter(error => !error.includes('Description')));
        }
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setHasAttemptedSubmit(true);

        const errors = validateForm();
        if (errors.length > 0) {
            setValidationErrors(errors);
            return;
        }

        setIsSubmitting(true);
        setValidationErrors([]);
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
        <form onSubmit={handleSubmit} className="px-4 space-y-4" noValidate>
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
            {errorTaxRegions && (
                <p className="text-red-600 text-sm">{errorTaxRegions}</p>
            )}
            <div>
                <Label htmlFor="tax-rate-region">Tax Region *</Label>
                <CustomSelect
                    id="tax-rate-region"
                    value={regionCode}
                    onValueChange={handleRegionCodeChange}
                    options={taxRegions.map(r => ({ value: r.region_code, label: r.region_name }))}
                    placeholder={isLoadingTaxRegions ? "Loading regions..." : "Select Tax Region *"}
                    disabled={isSubmitting || isLoadingTaxRegions}
                    required={true}
                    className={hasAttemptedSubmit && !regionCode ? 'ring-1 ring-red-500' : ''}
                />
            </div>
            <div>
                <Label htmlFor="tax-rate-percentage">Percentage (%) *</Label>
                <Input
                    id="tax-rate-percentage"
                    type="number"
                    step="0.01" // Allow decimals
                    value={percentage}
                    onChange={(e) => handlePercentageChange(e.target.value)}
                    placeholder="e.g., 8.25 *"
                    disabled={isSubmitting}
                    required
                    className={hasAttemptedSubmit && (!percentage.trim() || parseFloat(percentage) <= 0 || parseFloat(percentage) > 100) ? 'border-red-500' : ''}
                />
            </div>
            <div>
                <Label htmlFor="tax-rate-description">Description (Optional)</Label>
                <Input
                    id="tax-rate-description"
                    value={description}
                    onChange={(e) => handleDescriptionChange(e.target.value)}
                    placeholder="e.g., California State Tax"
                    disabled={isSubmitting}
                />
            </div>
            <div>
                <Label htmlFor="tax-rate-start-date">Start Date *</Label>
                <Input
                    id="tax-rate-start-date"
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                        setStartDate(e.target.value);
                        clearErrorIfSubmitted();
                    }}
                    disabled={isSubmitting}
                    required
                    className={hasAttemptedSubmit && !startDate ? 'border-red-500' : ''}
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
                    setHasAttemptedSubmit(false);
                    setValidationErrors([]);
                    // Attempt to find and click the Drawer's default close button
                    const closeButton = document.querySelector('button[aria-label="Close"]') as HTMLElement | null;
                    closeButton?.click();
                    // If that doesn't work, the parent's onOpenChange(false) should handle it
                }} disabled={isSubmitting}>Cancel</Button>
                <Button 
                    id="submit-create-tax-rate-button" 
                    type="submit" 
                    disabled={isSubmitting}
                    className={!regionCode || !percentage.trim() || !startDate ? 'opacity-50' : ''}
                >
                    {isSubmitting ? 'Creating...' : 'Create Tax Rate'}
                </Button>
            </div>
        </form>
    );
};

export default TaxRateCreateForm;
