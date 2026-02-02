import React, { useState, useEffect } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { ITaxRate, IClientTaxRate } from '@alga-psa/types';
import { ITaxRegion } from '@alga-psa/types';
import { getActiveTaxRegionsAsync } from '../../lib/billingHelpers';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import Drawer from '@alga-psa/ui/components/Drawer'; // Correct: Use default import
import TaxRateCreateForm from './TaxRateCreateForm';
import { toast } from 'react-hot-toast';

interface ClientTaxRatesProps {
    clientId: string;
    clientTaxRate: IClientTaxRate | null | undefined;
    taxRates: ITaxRate[];
    onAssignDefault: (taxRateId: string) => Promise<void>;
    onChangeDefault: (newTaxRateId: string) => Promise<void>;
    onTaxRateCreated: () => Promise<void>;
}

const ClientTaxRates: React.FC<ClientTaxRatesProps> = ({
    clientId,
    clientTaxRate,
    taxRates,
    onAssignDefault,
    onChangeDefault,
    onTaxRateCreated
}) => {
    const [taxRegions, setTaxRegions] = useState<Pick<ITaxRegion, 'region_code' | 'region_name'>[]>([]);
    const [isLoadingTaxRegions, setIsLoadingTaxRegions] = useState(true);
    const [errorTaxRegions, setErrorTaxRegions] = useState<string | null>(null);
    const [selectedRateToAdd, setSelectedRateToAdd] = useState<string>('');
    const [isAssigning, setIsAssigning] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [selectedRateToChange, setSelectedRateToChange] = useState<string>('');
    const [isSavingChange, setIsSavingChange] = useState(false);
    const [isCreateDrawerOpen, setIsCreateDrawerOpen] = useState(false);

    useEffect(() => {
        const fetchTaxRegions = async () => {
            try {
                setIsLoadingTaxRegions(true);
                const regions = await getActiveTaxRegionsAsync();
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

    const defaultTaxRateDetails = clientTaxRate
        ? taxRates.find(tr => tr.tax_rate_id === clientTaxRate.tax_rate_id)
        : null;

    const defaultTaxRegion = defaultTaxRateDetails
        ? taxRegions.find(reg => reg.region_code === defaultTaxRateDetails.region_code)
        : null;

    const regionName = defaultTaxRegion?.region_name || defaultTaxRateDetails?.region_code || 'N/A';
    const taxPercentage = defaultTaxRateDetails?.tax_percentage;
    const description = defaultTaxRateDetails?.description;

    const taxRateOptions = isLoadingTaxRegions ? [] : taxRates.map((taxRate): { value: string; label: string } => {
        const taxRegion = taxRegions.find(reg => reg.region_code === taxRate.region_code);
        const regionLabel = taxRegion?.region_name || taxRate.region_code || 'Unknown Region';
        return {
            value: taxRate.tax_rate_id!,
            label: `${regionLabel} - ${taxRate.tax_percentage}% (${taxRate.description || 'No Description'})`
        };
    });

    const handleAssignClick = async () => {
        if (!selectedRateToAdd) return;
        setIsAssigning(true);
        try {
            await onAssignDefault(selectedRateToAdd);
            setSelectedRateToAdd('');
        } catch (error) {
            console.error("Failed to assign default tax rate:", error);
        } finally {
            setIsAssigning(false);
        }
    };

    const handleSaveChangesClick = async () => {
        if (!selectedRateToChange || selectedRateToChange === clientTaxRate?.tax_rate_id) return;
        setIsSavingChange(true);
        try {
            await onChangeDefault(selectedRateToChange);
            setIsEditing(false);
        } catch (error) {
            console.error("Failed to change default tax rate:", error);
        } finally {
            setIsSavingChange(false);
        }
    };

    const handleCreateSuccess = async () => {
        setIsCreateDrawerOpen(false);
        toast.success('Tax rate created successfully.');
        await onTaxRateCreated();
    };

    const handleCreateError = (error: Error) => {
        console.error("Failed to create tax rate:", error);
        toast.error(`Failed to create tax rate: ${error.message}`);
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex justify-between items-center">
                    <span>Default Client Tax Rate</span>
                    {defaultTaxRateDetails && !isEditing && (
                        <Button id="change-default-tax-rate-button" variant="outline" size="sm" onClick={() => { setSelectedRateToChange(clientTaxRate?.tax_rate_id || ''); setIsEditing(true); }}>
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
                        // Editing Mode
                        <div className="space-y-4">
                            <CustomSelect
                                value={selectedRateToChange}
                                onValueChange={setSelectedRateToChange}
                                options={taxRateOptions}
                                placeholder="Select New Default Rate"
                                disabled={isSavingChange}
                            />
                            <div className="flex justify-end gap-2">
                                {/* Removed DrawerTrigger wrapper */}
                                <Button id="create-new-tax-rate-button-editing" variant="outline" size="sm" onClick={() => setIsCreateDrawerOpen(true)}>
                                    Create New Rate
                                </Button>
                                <Button id="cancel-change-tax-rate-button" variant="ghost" size="sm" onClick={() => setIsEditing(false)} disabled={isSavingChange}>
                                    Cancel
                                </Button>
                                <Button
                                    id="save-change-tax-rate-button"
                                    size="sm"
                                    onClick={handleSaveChangesClick}
                                    disabled={!selectedRateToChange || selectedRateToChange === clientTaxRate?.tax_rate_id || isSavingChange}
                                >
                                    {isSavingChange ? 'Saving...' : 'Save Change'}
                                </Button>
                            </div>
                        </div>
                    ) : (
                        // Display Mode
                        <div className="space-y-2">
                            <div>
                                <span className="font-semibold text-sm text-gray-600">Region:</span>
                                <span className="ml-2 text-sm">{regionName}</span>
                            </div>
                            <div>
                                <span className="font-semibold text-sm text-gray-600">Tax Percentage:</span>
                                <span className="ml-2 text-sm">{taxPercentage !== undefined ? `${taxPercentage}%` : 'N/A'}</span>
                            </div>
                            <div>
                                <span className="font-semibold text-sm text-gray-600">Description:</span>
                                <span className="ml-2 text-sm">{description || 'N/A'}</span>
                            </div>
                        </div>
                    )
                ) : (
                    // Assigning Mode
                    <div className="space-y-4">
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
                        <div className="flex justify-start">
                             {/* Removed DrawerTrigger wrapper */}
                            <Button id="create-new-tax-rate-button-assigning" variant="outline" size="sm" onClick={() => setIsCreateDrawerOpen(true)}>
                                Create New Rate
                            </Button>
                        </div>
                    </div>
                )}
            </CardContent>

            {/* Drawer for Creating New Tax Rate */}
            <Drawer isOpen={isCreateDrawerOpen} onClose={() => setIsCreateDrawerOpen(false)} id="create-tax-rate-drawer">
                 {/* Use standard elements for header */}
                 <div className="p-4 border-b"> {/* Added padding and border */}
                    <h2 className="text-lg font-semibold">Create New Tax Rate</h2>
                    <p className="text-sm text-muted-foreground">Enter the details for the new tax rate.</p>
                 </div>
                <TaxRateCreateForm onSuccess={handleCreateSuccess} onError={handleCreateError} />
            </Drawer>
        </Card>
    );
};

export default ClientTaxRates;
