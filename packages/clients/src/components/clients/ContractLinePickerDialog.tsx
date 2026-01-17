import { useState } from 'react';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { IContractLine, IServiceCategory } from 'server/src/interfaces/billing.interfaces';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';

interface PlanPickerDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (plan: IContractLine, serviceCategory: string | undefined, startDate: string, endDate: string | null) => void;
    availablePlans: IContractLine[];
    serviceCategories: IServiceCategory[];
    initialValues?: {
        planId?: string;
        categoryId?: string;
        startDate?: string;
        endDate?: string | null;
        ongoing?: boolean;
    };
}

const PlanPickerDialog: React.FC<PlanPickerDialogProps> = ({
    isOpen,
    onClose,
    onSelect,
    availablePlans,
    serviceCategories,
    initialValues
}) => {
    const [selectedPlan, setSelectedPlan] = useState<IContractLine | null>(
        initialValues?.planId ? availablePlans.find(p => p.contract_line_id === initialValues.planId) || null : null
    );
    const [selectedCategory, setSelectedCategory] = useState<string>(
        !initialValues?.categoryId ? 'none' : initialValues.categoryId
    );
    const [startDate, setStartDate] = useState<string>(
        initialValues?.startDate || new Date().toISOString().split('T')[0]
    );
    const [endDate, setEndDate] = useState<string | null>(
        initialValues?.endDate || null
    );
    const [isOngoing, setIsOngoing] = useState(
        initialValues?.ongoing !== undefined ? initialValues.ongoing : true
    );

    const handleSubmit = () => {
        if (selectedPlan) {
            onSelect(
                selectedPlan, 
                selectedCategory === 'none' ? undefined : selectedCategory,
                startDate,
                endDate
            );
            onClose();
        }
    };

    return (
        <Dialog 
          isOpen={isOpen} 
          onClose={onClose} 
          className="sm:max-w-4xl" 
          title="Select a Contract Line"
        >
            <DialogContent>
                <div className="mt-4 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Contract Line
                        </label>
                        <CustomSelect
                            value={selectedPlan?.contract_line_id || ''}
                            onValueChange={(planId) => {
                                const plan = availablePlans.find(p => p.contract_line_id === planId);
                                setSelectedPlan(plan || null);
                            }}
                            options={availablePlans.map((plan): { value: string; label: string } => ({
                                value: plan.contract_line_id || '',
                                label: plan.contract_line_name
                            }))}
                            placeholder="Select contract line..."
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Service Category
                            </label>
                            <CustomSelect
                                value={selectedCategory}
                                onValueChange={setSelectedCategory}
                                options={[
                                    { value: 'none', label: 'All Categories' },
                                    ...serviceCategories.map((category): { value: string; label: string } => ({
                                        value: category.category_id || 'None',
                                        label: category.category_name
                                    }))
                                ]}
                                placeholder="Select category..."
                            />
                            <p className="mt-1 text-xs text-gray-500">
                                Selecting 'All Categories' means this plan applies regardless of the service category.
                            </p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Start Date
                            </label>
                            <Input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                End Date
                            </label>
                            <div className="flex items-center gap-2 [&>div]:mb-0">
                                <Checkbox
                                    id="ongoing"
                                    label="Ongoing"
                                    checked={isOngoing}
                                    onChange={(e) => {
                                        setIsOngoing((e.target as HTMLInputElement).checked);
                                        // If switching to ongoing, set endDate to null
                                        // If switching from ongoing, set a default end date only if there isn't one already
                                        if ((e.target as HTMLInputElement).checked) {
                                            setEndDate(null);
                                        } else if (!endDate) {
                                            setEndDate(new Date().toISOString().split('T')[0]);
                                        }
                                    }}
                                />
                            </div>
                            <Input
                                type="date"
                                value={endDate || ''}
                                onChange={(e) => {
                                    // Make sure we're setting null if the value is empty
                                    setEndDate(e.target.value || null);
                                    // If a date is selected, make sure ongoing is false
                                    if (e.target.value) {
                                        setIsOngoing(false);
                                    }
                                }}
                                disabled={isOngoing}
                            />
                        </div>
                    </div>
                </div>
            </DialogContent>
            <DialogFooter>
                <div className="flex justify-end space-x-2">
                    <Button 
                        id="plan-picker-cancel-btn"
                        variant="outline" 
                        onClick={onClose}
                    >
                        Cancel
                    </Button>
                    <Button 
                        id="plan-picker-submit-btn"
                        onClick={handleSubmit}
                        disabled={!selectedPlan}
                    >
                        {initialValues ? 'Update Plan' : 'Add Plan'}
                    </Button>
                </div>
            </DialogFooter>
        </Dialog>
    );
};

export default PlanPickerDialog;
