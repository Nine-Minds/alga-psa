'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Card, Box } from '@radix-ui/themes';
import { Button } from 'server/src/components/ui/Button';
import { Plus, MoreVertical, Settings } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from 'server/src/components/ui/DropdownMenu';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { IContract, IContractLineMapping } from 'server/src/interfaces/contract.interfaces';
import { IContractLine } from 'server/src/interfaces/billing.interfaces';
import { getContractLines } from '@product/actions/contractLineAction';
import {
  getDetailedContractLines,
  addContractLine,
  removeContractLine,
  updateContractLineAssociation,
} from '@product/actions/contractLineMappingActions';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';
import { ContractLineRateDialog } from './ContractLineRateDialog';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';

interface ContractLinesProps {
  contract: IContract;
  onContractLinesChanged?: () => void;
}

interface DetailedContractLineMapping extends IContractLineMapping {
  contract_line_name: string;
  billing_frequency: string;
  contract_line_type: string;
  default_rate?: number;
}

const ContractLines: React.FC<ContractLinesProps> = ({ contract, onContractLinesChanged }) => {
  const [contractLines, setContractLines] = useState<DetailedContractLineMapping[]>([]);
  const [availableContractLines, setAvailableContractLines] = useState<IContractLine[]>([]);
  const [selectedLineToAdd, setSelectedLineToAdd] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingLine, setEditingLine] = useState<DetailedContractLineMapping | null>(null);

  useEffect(() => {
    if (contract.contract_id) {
      void fetchData();
    }
  }, [contract.contract_id]);

  const fetchData = async () => {
    if (!contract.contract_id) return;

    setIsLoading(true);
    setError(null);

    try {
      const [allContractLines, detailedContractLines] = await Promise.all([
        getContractLines(),
        getDetailedContractLines(contract.contract_id),
      ]);

      setContractLines(detailedContractLines);
      setAvailableContractLines(allContractLines);

      const unusedLines = allContractLines.filter(
        (line) => !detailedContractLines.some((cl) => cl.contract_line_id === line.contract_line_id)
      );

      setSelectedLineToAdd(unusedLines.length > 0 ? unusedLines[0].contract_line_id ?? null : null);
    } catch (err) {
      console.error('Error fetching contract lines:', err);
      setError('Failed to load contract lines');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddContractLine = async () => {
    if (!contract.contract_id || !selectedLineToAdd) return;

    try {
      await addContractLine(contract.contract_id, selectedLineToAdd, undefined);
      await fetchData();
      onContractLinesChanged?.();
    } catch (err) {
      console.error('Error adding contract line:', err);
      setError('Failed to add contract line');
    }
  };

  const handleRemoveContractLine = async (contractLineId: string) => {
    if (!contract.contract_id) return;

    try {
      await removeContractLine(contract.contract_id, contractLineId);
      await fetchData();
      onContractLinesChanged?.();
    } catch (err) {
      console.error('Error removing contract line:', err);
      setError(err instanceof Error ? err.message : 'Failed to remove contract line');
    }
  };

  const handleCustomRateSave = async (contractLineId: string, customRate?: number) => {
    if (!contract.contract_id) return;

    try {
      await updateContractLineAssociation(contract.contract_id, contractLineId, { custom_rate: customRate });
      await fetchData();
      setEditingLine(null);
      onContractLinesChanged?.();
    } catch (err) {
      console.error('Error updating contract line rate:', err);
      setError('Failed to update contract line rate');
    }
  };

  const contractLineColumns: ColumnDefinition<DetailedContractLineMapping>[] = useMemo(
    () => [
      {
        title: 'Contract Line',
        dataIndex: 'contract_line_name',
      },
      {
        title: 'Line Type',
        dataIndex: 'contract_line_type',
      },
      {
        title: 'Billing Frequency',
        dataIndex: 'billing_frequency',
      },
      {
        title: 'Default Rate',
        dataIndex: 'default_rate',
        render: (value) =>
          value !== undefined ? `$${parseFloat(value.toString()).toFixed(2)}` : 'N/A',
      },
      {
        title: 'Custom Rate',
        dataIndex: 'custom_rate',
        render: (value) =>
          value !== undefined && value !== null
            ? `$${parseFloat(value.toString()).toFixed(2)}`
            : 'Same as default',
      },
      {
        title: 'Actions',
        dataIndex: 'contract_line_id',
        render: (value, record) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                id={`actions-${value}`}
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={(event) => event.stopPropagation()}
              >
                <span className="sr-only">Open menu</span>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditingLine(record)}>
                <Settings className="h-4 w-4 mr-2" />
                Set Custom Rate
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-red-600 focus:text-red-600"
                onClick={(event) => {
                  event.stopPropagation();
                  handleRemoveContractLine(value);
                }}
              >
                Remove from Contract
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    []
  );

  if (isLoading) {
    return (
      <Card size="2">
        <Box p="8">
          <LoadingIndicator
            layout="stacked"
            className="py-6 text-gray-600"
            spinnerProps={{ size: 'md' }}
            text="Loading contract lines"
          />
        </Box>
      </Card>
    );
  }

  return (
    <Card size="2">
      <Box p="4" className="space-y-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-medium">Contract Lines</h3>
            <p className="text-sm text-gray-600">
              Manage the contract lines associated with this contract
            </p>
          </div>
          <div className="flex items-center gap-2">
            <CustomSelect
              value={selectedLineToAdd}
              onValueChange={setSelectedLineToAdd}
              options={availableContractLines
                .filter(
                  (line) =>
                    !contractLines.some(
                      (existing) => existing.contract_line_id === line.contract_line_id
                    )
                )
                .map((line) => ({
                  label: line.contract_line_name ?? 'Unnamed Contract Line',
                  value: line.contract_line_id ?? '',
                }))}
              placeholder="Select contract line"
            />
            <Button id="add-contract-line-btn" onClick={handleAddContractLine} disabled={!selectedLineToAdd}>
              <Plus className="h-4 w-4 mr-2" />
              Add Contract Line
            </Button>
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DataTable data={contractLines} columns={contractLineColumns} pagination={false} />
      </Box>

      {editingLine && (
        <ContractLineRateDialog
          plan={editingLine}
          onClose={() => setEditingLine(null)}
          onSave={handleCustomRateSave}
        />
      )}
    </Card>
  );
};

export default ContractLines;
