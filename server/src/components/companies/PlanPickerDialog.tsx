import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { IBillingPlan, IServiceCategory } from '@/interfaces/billing.interfaces';
import { DataTable } from '@/components/ui/DataTable';
import CustomSelect from '@/components/ui/CustomSelect';

interface PlanPickerDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (plan: IBillingPlan, serviceCategory: string | undefined, startDate: string) => void;
    availablePlans: IBillingPlan[];
    serviceCategories: IServiceCategory[];
}

const PlanPickerDialog: React.FC<PlanPickerDialogProps> = ({
    isOpen,
    onClose,
    onSelect,
    availablePlans,
    serviceCategories
}) => {
    const [selectedPlan, setSelectedPlan] = useState<IBillingPlan | null>(null);
    const [selectedCategory, setSelectedCategory] = useState<string>('');
    const [startDate, setStartDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );

    const handleSubmit = () => {
        if (selectedPlan) {
            onSelect(
                selectedPlan, 
                selectedCategory === 'none' ? undefined : selectedCategory,
                startDate
            );
            onClose();
        }
    };
    return (
        <Dialog isOpen={isOpen} onClose={onClose} className="sm:max-w-4xl">
            <DialogHeader>
                <DialogTitle>Select a Billing Plan</DialogTitle>
            </DialogHeader>
            <DialogContent>
                <div className="mt-4 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Billing Plan
                        </label>
                        <CustomSelect
                            value={selectedPlan?.plan_id || ''}
                            onValueChange={(planId) => {
                                const plan = availablePlans.find(p => p.plan_id === planId);
                                setSelectedPlan(plan || null);
                            }}
                            options={availablePlans.map(plan => ({
                                value: plan.plan_id || '',
                                label: `${plan.plan_name}${plan.description ? ` - ${plan.description}` : ''}`
                            }))}
                            placeholder="Select billing plan..."
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
                                    { value: 'none', label: 'None' },
                                    ...serviceCategories.map(category => ({
                                        value: category.category_id,
                                        label: category.category_name
                                    }))
                                ]}
                                placeholder="Select category..."
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Start Date
                            </label>
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                            />
                        </div>
                    </div>
                </div>
            </DialogContent>
            <DialogFooter>
                <div className="flex justify-end space-x-2">
                    <Button variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button 
                        onClick={handleSubmit}
                        disabled={!selectedPlan}
                    >
                        Add Plan
                    </Button>
                </div>
            </DialogFooter>
        </Dialog>
    );
};

export default PlanPickerDialog;
