import React, { useState, useEffect } from 'react'; // Added useState, useEffect
import { Button } from 'server/src/components/ui/Button';
import { ITaxRate, ICompanyTaxRate } from 'server/src/interfaces/billing.interfaces';
import { ITaxRegion } from 'server/src/interfaces/tax.interfaces'; // Added
import { getActiveTaxRegions } from 'server/src/lib/actions/taxSettingsActions'; // Added
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card'; // Updated Card import
import CustomSelect from 'server/src/components/ui/CustomSelect'; // Re-added for assigning default

// Updated Props: Expecting only the single default rate, removing selection/add/remove handlers for now.
// Change/Update functionality might be added later if needed.
interface CompanyTaxRatesProps {
    companyId: string; // Needed for assigning
    companyTaxRate: ICompanyTaxRate | null | undefined; // Expecting the single default rate or null/undefined
    taxRates: ITaxRate[]; // Full list of available rates
    onAssignDefault: (taxRateId: string) => Promise<void>; // Handler for initial assignment
    onChangeDefault: (newTaxRateId: string) => Promise<void>; // Handler for changing the default
}

// Removed TaxRateTableData interface as DataTable is removed

const CompanyTaxRates: React.FC<CompanyTaxRatesProps> = ({
    companyId,
    companyTaxRate,
    taxRates,
    onAssignDefault,
    onChangeDefault // Added new handler prop
}) => {
    const [taxRegions, setTaxRegions] = useState<Pick<ITaxRegion, 'region_code' | 'region_name'>[]>([]);
    const [isLoadingTaxRegions, setIsLoadingTaxRegions] = useState(true);
    const [errorTaxRegions, setErrorTaxRegions] = useState<string | null>(null);
    const [selectedRateToAdd, setSelectedRateToAdd] = useState<string>(''); // State for the dropdown
    const [isAssigning, setIsAssigning] = useState(false); // State for assigning button loading
    const [isEditing, setIsEditing] = useState(false); // State to toggle edit mode
    const [selectedRateToChange, setSelectedRateToChange] = useState<string>(''); // State for edit dropdown
    const [isSavingChange, setIsSavingChange] = useState(false); // State for save button loading

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

    // Find the details for the single default tax rate
    const defaultTaxRateDetails = companyTaxRate
        ? taxRates.find(tr => tr.tax_rate_id === companyTaxRate.tax_rate_id)
        : null;

    const defaultTaxRegion = defaultTaxRateDetails
        ? taxRegions.find(reg => reg.region_code === defaultTaxRateDetails.region_code)
        : null;

    const regionName = defaultTaxRegion?.region_name || defaultTaxRateDetails?.region_code || 'N/A';
    const taxPercentage = defaultTaxRateDetails?.tax_percentage;
    const description = defaultTaxRateDetails?.description;

    // Generate options for the assignment dropdown
    const taxRateOptions = isLoadingTaxRegions ? [] : taxRates.map((taxRate): { value: string; label: string } => {
        const taxRegion = taxRegions.find(reg => reg.region_code === taxRate.region_code);
        const regionLabel = taxRegion?.region_name || taxRate.region_code || 'Unknown Region';
        return {
            value: taxRate.tax_rate_id!,
            // Combine relevant info for the label
            label: `${regionLabel} - ${taxRate.tax_percentage}% (${taxRate.description || 'No Description'})`
        };
    });

    const handleAssignClick = async () => {
        if (!selectedRateToAdd) return;
        setIsAssigning(true);
        try {
            await onAssignDefault(selectedRateToAdd);
            setSelectedRateToAdd(''); // Clear selection on success
        } catch (error) {
            // Error handling might be done in the parent, or display here
            console.error("Failed to assign default tax rate:", error);
        } finally {
            setIsAssigning(false);
        }
    };

    const handleSaveChangesClick = async () => {
        if (!selectedRateToChange || selectedRateToChange === companyTaxRate?.tax_rate_id) return;
        setIsSavingChange(true);
        try {
            await onChangeDefault(selectedRateToChange);
            setIsEditing(false); // Close edit mode on success
        } catch (error) {
            console.error("Failed to change default tax rate:", error);
            // Error handled in parent, potentially show local error if needed
        } finally {
            setIsSavingChange(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex justify-between items-center">
                    <span>Default Company Tax Rate</span>
                    {/* Show Change button only if a rate is assigned and not currently editing */}
                    {defaultTaxRateDetails && !isEditing && (
                        <Button id="change-default-tax-rate-button" variant="outline" size="sm" onClick={() => { setSelectedRateToChange(companyTaxRate?.tax_rate_id || ''); setIsEditing(true); }}>
                            Change
                        </Button>
                    )}
                </CardTitle>
            </CardHeader>
            <CardContent>
                {isLoadingTaxRegions ? (
                    <p>Loading tax details...</p>
                ) : errorTaxRegions ? (
                    <p className="text-red-600">{errorTaxRegions}</p>
                ) : defaultTaxRateDetails ? (
                    isEditing ? (
                        // Editing Mode: Show dropdown and Save/Cancel
                        <div className="space-y-4">
                            <CustomSelect
                                value={selectedRateToChange}
                                onValueChange={setSelectedRateToChange}
                                options={taxRateOptions}
                                placeholder="Select New Default Rate"
                                disabled={isSavingChange}
                            />
                            <div className="flex justify-end gap-2">
                                <Button id="cancel-change-tax-rate-button" variant="ghost" size="sm" onClick={() => setIsEditing(false)} disabled={isSavingChange}>
                                    Cancel
                                </Button>
                                <Button
                                    id="save-change-tax-rate-button"
                                    size="sm"
                                    onClick={handleSaveChangesClick} // Ensure this function is defined correctly above
                                    disabled={!selectedRateToChange || selectedRateToChange === companyTaxRate?.tax_rate_id || isSavingChange}
                                >
                                    {isSavingChange ? 'Saving...' : 'Save Change'}
                                </Button>
                            </div>
                        </div>
                    ) : (
                        // Display Mode: Show rate details
                        <div className="space-y-2">
                            <div>
                                <span className="font-semibold text-sm text-gray-600 dark:text-gray-400">Region:</span>
                                <span className="ml-2 text-sm">{regionName}</span>
                            </div>
                            <div>
                                <span className="font-semibold text-sm text-gray-600 dark:text-gray-400">Tax Percentage:</span>
                                <span className="ml-2 text-sm">{taxPercentage !== undefined ? `${taxPercentage}%` : 'N/A'}</span>
                            </div>
                            <div>
                                <span className="font-semibold text-sm text-gray-600 dark:text-gray-400">Description:</span>
                                <span className="ml-2 text-sm">{description || 'N/A'}</span>
                            </div>
                        </div>
                    )
                ) : (
                    <div>
                        <p className="mb-4">No default tax rate assigned.</p>
                        <div className="flex items-center gap-4">
                            <div className="flex-1">
                                <CustomSelect
                                    value={selectedRateToAdd}
                                    onValueChange={setSelectedRateToAdd}
                                    options={taxRateOptions}
                                    placeholder={isLoadingTaxRegions ? "Loading rates..." : "Select Tax Rate to Assign"}
                                    disabled={isLoadingTaxRegions || isAssigning}
                                />
                            </div>
                            <Button
                                id="assign-default-tax-rate-button"
                                onClick={handleAssignClick}
                                disabled={!selectedRateToAdd || isAssigning}
                                size="default"
                            >
                                {isAssigning ? 'Assigning...' : 'Assign Default Rate'}
                            </Button>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

export default CompanyTaxRates;
