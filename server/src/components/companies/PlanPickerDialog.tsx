import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { IBillingPlan, IServiceCategory } from '@/interfaces/billing.interfaces';
import CustomSelect from '@/components/ui/CustomSelect';

interface PlanPickerDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (plan: IBillingPlan, serviceCategory: string | undefined, startDate: string, endDate: string | null) => void;
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
    const [endDate, setEndDate] = useState<string | null>(null);
    const [isOngoing, setIsOngoing] = useState(true);

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
                            options={availablePlans.map((plan): { value: string; label: string } => ({
                                value: plan.plan_id || '',
                                label: plan.plan_name
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
                                    ...serviceCategories.map((category): { value: string; label: string } => ({
                                        value: category.category_id || 'None',
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
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="ongoing"
                                    checked={isOngoing}
                                    onChange={(e) => {
                                        setIsOngoing(e.target.checked);
                                        setEndDate(e.target.checked ? null : new Date().toISOString().split('T')[0]);
                                    }}
                                />
                                <label htmlFor="ongoing">Ongoing</label>
                            </div>
                            <Input
                                type="date"
                                value={endDate || ''}
                                onChange={(e) => setEndDate(e.target.value || null)}
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
                        Add Plan
                    </Button>
                </div>
            </DialogFooter>
        </Dialog>
    );
};

export default PlanPickerDialog;
