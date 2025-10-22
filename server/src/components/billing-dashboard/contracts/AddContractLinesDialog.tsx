'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import { Badge } from 'server/src/components/ui/Badge';
import { Search, ChevronDown, ChevronUp } from 'lucide-react';
import { IContractLine } from 'server/src/interfaces/billing.interfaces';
import { getContractLineServicesWithNames } from 'server/src/lib/actions/contractLineServiceActions';
import { IContractLineService } from 'server/src/interfaces/billing.interfaces';

interface ContractLineServiceWithName extends IContractLineService {
  service_name?: string;
}

interface AddContractLinesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  availableContractLines: IContractLine[];
  onAdd: (selectedLineIds: string[]) => Promise<void>;
}

export const AddContractLinesDialog: React.FC<AddContractLinesDialogProps> = ({
  isOpen,
  onClose,
  availableContractLines,
  onAdd,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set());
  const [expandedLines, setExpandedLines] = useState<Record<string, boolean>>({});
  const [lineServices, setLineServices] = useState<Record<string, ContractLineServiceWithName[]>>({});
  const [isAdding, setIsAdding] = useState(false);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('');
      setSelectedLineIds(new Set());
      setExpandedLines({});
      setLineServices({});
    }
  }, [isOpen]);

  const filteredContractLines = availableContractLines.filter((line) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      line.contract_line_name?.toLowerCase().includes(search) ||
      line.billing_frequency?.toLowerCase().includes(search) ||
      line.contract_line_type?.toLowerCase().includes(search) ||
      line.service_category?.toLowerCase().includes(search)
    );
  });

  const toggleContractLine = (contractLineId: string) => {
    const newSet = new Set(selectedLineIds);
    if (newSet.has(contractLineId)) {
      newSet.delete(contractLineId);
    } else {
      newSet.add(contractLineId);
    }
    setSelectedLineIds(newSet);
  };

  const toggleExpand = async (contractLineId: string) => {
    const isExpanded = expandedLines[contractLineId];

    setExpandedLines(prev => ({
      ...prev,
      [contractLineId]: !isExpanded
    }));

    // Load services if expanding and not already loaded
    if (!isExpanded && !lineServices[contractLineId]) {
      try {
        const servicesWithNames = await getContractLineServicesWithNames(contractLineId);
        setLineServices(prev => ({
          ...prev,
          [contractLineId]: servicesWithNames
        }));
      } catch (error) {
        console.error(`Error loading services for contract line ${contractLineId}:`, error);
      }
    }
  };

  const handleAdd = async () => {
    if (selectedLineIds.size === 0) return;

    setIsAdding(true);
    try {
      await onAdd(Array.from(selectedLineIds));
      onClose();
    } catch (error) {
      console.error('Error adding contract lines:', error);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Add Contract Lines">
      <DialogHeader>
        <DialogTitle>Select Contract Lines to Add</DialogTitle>
      </DialogHeader>

      <DialogContent className="max-h-[70vh] overflow-hidden flex flex-col">
        <div className="space-y-4">
          {/* Search Input */}
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400"
              aria-hidden="true"
            />
            <Input
              type="text"
              placeholder="Search contract lines..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Contract Lines List */}
          <div className="flex-1 overflow-y-auto border rounded-md p-2 space-y-1 max-h-96">
            {availableContractLines.length === 0 ? (
              <div className="text-sm text-gray-500 p-4 text-center">
                All available contract lines have been added to this contract.
              </div>
            ) : filteredContractLines.length === 0 ? (
              <div className="text-sm text-gray-500 p-4 text-center">
                No contract lines match your search.
              </div>
            ) : (
              filteredContractLines.map((line) => {
                if (!line.contract_line_id) return null;
                const isExpanded = expandedLines[line.contract_line_id];
                const services = lineServices[line.contract_line_id] || [];

                return (
                  <div key={line.contract_line_id} className="border rounded">
                    {/* Main row with checkbox and expand button */}
                    <div className="flex items-center gap-2 p-2 hover:bg-gray-50">
                      <Checkbox
                        id={`line-${line.contract_line_id}`}
                        checked={selectedLineIds.has(line.contract_line_id)}
                        onChange={() => line.contract_line_id && toggleContractLine(line.contract_line_id)}
                      />
                      <Label
                        htmlFor={`line-${line.contract_line_id}`}
                        className="flex-1 cursor-pointer text-sm"
                      >
                        <div className="font-medium">{line.contract_line_name}</div>
                        <div className="flex items-center gap-2 text-xs mt-0.5">
                          <Badge
                            className={`text-xs ${
                              line.contract_line_type === 'Fixed'
                                ? 'bg-green-100 text-green-800'
                                : line.contract_line_type === 'Hourly'
                                ? 'bg-purple-100 text-purple-800'
                                : line.contract_line_type === 'Usage'
                                ? 'bg-indigo-100 text-indigo-800'
                                : 'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {line.contract_line_type}
                          </Badge>
                          <span className="text-gray-500">•</span>
                          <span className="text-gray-500">{line.billing_frequency}</span>
                        </div>
                      </Label>
                      <button
                        type="button"
                        onClick={() => line.contract_line_id && toggleExpand(line.contract_line_id)}
                        className="p-1 hover:bg-gray-200 rounded"
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-gray-600" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-gray-600" />
                        )}
                      </button>
                    </div>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="px-4 py-2 bg-gray-50 border-t text-xs space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <span className="font-medium text-gray-600">Type:</span>
                            <span className="ml-1">{line.contract_line_type}</span>
                          </div>
                          <div>
                            <span className="font-medium text-gray-600">Frequency:</span>
                            <span className="ml-1">{line.billing_frequency}</span>
                          </div>
                          {line.service_category && (
                            <div className="col-span-2">
                              <span className="font-medium text-gray-600">Category:</span>
                              <span className="ml-1">{line.service_category}</span>
                            </div>
                          )}
                        </div>

                        {/* Services */}
                        <div>
                          <div className="font-medium text-gray-600 mb-1">Services Included:</div>
                          {services.length === 0 ? (
                            <div className="text-gray-500 italic">No services configured</div>
                          ) : (
                            <ul className="list-disc list-inside space-y-0.5 text-gray-700">
                              {services.map((service, idx) => (
                                <li key={idx}>
                                  {service.service_name || 'Unknown Service'}
                                  {service.quantity && ` (Qty: ${service.quantity})`}
                                  {service.custom_rate && ` - $${(service.custom_rate / 100).toFixed(2)}`}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Selected count */}
          {selectedLineIds.size > 0 && (
            <div className="text-sm text-blue-600 font-medium">
              {selectedLineIds.size} contract line{selectedLineIds.size > 1 ? 's' : ''} selected
            </div>
          )}
        </div>
      </DialogContent>

      <DialogFooter>
        <Button
          variant="outline"
          onClick={onClose}
          disabled={isAdding}
        >
          Cancel
        </Button>
        <Button
          onClick={handleAdd}
          disabled={selectedLineIds.size === 0 || isAdding}
        >
          {isAdding ? 'Adding...' : `Add ${selectedLineIds.size > 0 ? `(${selectedLineIds.size})` : ''} Line${selectedLineIds.size !== 1 ? 's' : ''}`}
        </Button>
      </DialogFooter>
    </Dialog>
  );
};
