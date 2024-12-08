'use client'
import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { LineItem } from './LineItem';
import { CompanyPicker } from '../companies/CompanyPicker';
import { ICompany } from '../../interfaces';
import { ErrorBoundary } from 'react-error-boundary';
import { IService } from '../../interfaces/billing.interfaces';
import type { JSX } from 'react';

// Use a constant for environment check since process.env is not available
const IS_DEVELOPMENT = typeof window !== 'undefined' && 
  globalThis.window.location.hostname === 'localhost';

interface ServiceWithRate extends Pick<IService, 'service_id' | 'service_name'> {
  rate: number;  // Maps to default_rate from IService
}

interface SelectOption {
  value: string;
  label: string;
}

interface InvoiceItem {
  service_id: string;
  quantity: number;
  description: string;
  rate: number;
}

interface ManualInvoicesProps {
  companies: ICompany[];
  services: ServiceWithRate[];
  onGenerateSuccess: () => void;
}

function ErrorFallback({ error, resetErrorBoundary }: { error: Error; resetErrorBoundary: () => void }) {
  return (
    <div className="p-4 bg-red-50 border border-red-200 rounded-md">
      <h2 className="text-lg font-semibold text-red-800">Something went wrong:</h2>
      <pre className="mt-2 text-sm text-red-600">{error.message}</pre>
      <Button
        onClick={resetErrorBoundary}
        className="mt-4"
        variant="secondary"
      >
        Try again
      </Button>
    </div>
  );
}

const ManualInvoicesContent: React.FC<ManualInvoicesProps> = ({ companies, services, onGenerateSuccess }) => {
  const [selectedCompany, setSelectedCompany] = useState<string>('');
  const [items, setItems] = useState<InvoiceItem[]>([{
    service_id: '',
    quantity: 1,
    description: '',
    rate: 0
  }]);
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set([0]));
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');

  const handleAddItem = () => {
    const newItems = [...items, {
      service_id: '',
      quantity: 1,
      description: '',
      rate: 0
    }];
    setItems(newItems);
    // Collapse all existing items and expand only the new one
    setExpandedItems(new Set([newItems.length - 1]));
  };

  const handleRemoveItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: keyof InvoiceItem, value: string | number) => {
    const newItems = [...items];
    if (field === 'service_id') {
      const service = services.find(s => s.service_id === value);
      if (!service) {
        // Skip console warning in production
        if (IS_DEVELOPMENT) {
          globalThis.console.warn(`Service not found for ID: ${value}`);
        }
        newItems[index] = {
          ...newItems[index],
          [field]: value as string
        };
      } else {
        // Always update rate when service changes
        newItems[index] = {
          ...newItems[index],
          [field]: value as string,
          rate: service.rate,
          description: service.service_name // Optionally pre-fill description
        };
      }
    } else if (field === 'quantity' || field === 'rate') {
      newItems[index] = {
        ...newItems[index],
        [field]: value as number
      };
    } else {
      newItems[index] = {
        ...newItems[index],
        [field]: value as string
      };
    }
    setItems(newItems);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCompany || items.some(item => !item.service_id || !item.description)) {
      setError('Please fill in all required fields');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      // TODO: Implement manual invoice generation
      // await generateManualInvoice({
      //   companyId: selectedCompany,
      //   items: items
      // });
      
      // Clear form
      setSelectedCompany('');
      setItems([{
        service_id: '',
        quantity: 1,
        description: '',
        rate: 0
      }]);
      
      onGenerateSuccess();
    } catch (err) {
      setError('Error generating invoice');
      if (IS_DEVELOPMENT) {
        globalThis.console.error('Error generating invoice:', err);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const serviceOptions: SelectOption[] = services.map((service): SelectOption => ({
    value: service.service_id,
    label: service.service_name
  }));

  const calculateTotal = () => {
    return items.reduce((sum, item) => sum + (item.quantity * item.rate), 0);
  };

  return (
    <Card>
      <div className="p-6">
        <h2 className="text-lg font-semibold mb-4">Generate Manual Invoice</h2>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Company
            </label>
            <CompanyPicker
              companies={companies}
              selectedCompanyId={selectedCompany}
              onSelect={setSelectedCompany}
              filterState={filterState}
              onFilterStateChange={setFilterState}
              clientTypeFilter={clientTypeFilter}
              onClientTypeFilterChange={setClientTypeFilter}
            />
          </div>

          <div className="space-y-2">
            {items.map((item, index):JSX.Element => (
              <LineItem
                key={index}
                item={item}
                index={index}
                isExpanded={expandedItems.has(index)}
                serviceOptions={serviceOptions}
                onRemove={() => handleRemoveItem(index)}
                onChange={(field, value) => handleItemChange(index, field as keyof InvoiceItem, value)}
                onToggleExpand={() => {
                  const newExpanded = new Set(expandedItems);
                  if (newExpanded.has(index)) {
                    newExpanded.delete(index);
                  } else {
                    newExpanded.add(index);
                  }
                  setExpandedItems(newExpanded);
                }}
              />
            ))}
          </div>

          <div className="flex justify-between items-center">
            <Button
              type="button"
              onClick={handleAddItem}
              variant="secondary"
            >
              New Line Item
            </Button>
            <div className="text-lg font-semibold">
              Total: ${calculateTotal().toFixed(2)}
            </div>
          </div>

          <Button
            type="submit"
            disabled={isGenerating || !selectedCompany || items.some(item => !item.service_id || !item.description)}
            className="w-full"
          >
            {isGenerating ? 'Generating...' : 'Generate Manual Invoice'}
          </Button>
        </form>
      </div>
    </Card>
  );
};

const ManualInvoices: React.FC<ManualInvoicesProps> = (props) => {
  return (
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      onReset={() => {
        // Reset the state when the error boundary is reset
        globalThis.window.location.reload();
      }}
    >
      <ManualInvoicesContent {...props} />
    </ErrorBoundary>
  );
};

export default ManualInvoices;
