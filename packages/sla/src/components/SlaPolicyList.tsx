'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { ISlaPolicy } from '../types';
import { getSlaPolicies, deleteSlaPolicy, setDefaultSlaPolicy } from '../actions';
import { MoreVertical } from 'lucide-react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from '@alga-psa/types';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@alga-psa/ui/components/DropdownMenu';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Badge } from '@alga-psa/ui/components/Badge';

interface SlaPolicyListProps {
  onEditPolicy?: (policy: ISlaPolicy) => void;
  onAddPolicy?: () => void;
}

export function SlaPolicyList({ onEditPolicy, onAddPolicy }: SlaPolicyListProps) {
  const [policies, setPolicies] = useState<ISlaPolicy[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [policyToDelete, setPolicyToDelete] = useState<ISlaPolicy | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const fetchPolicies = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const fetchedPolicies = await getSlaPolicies();
      setPolicies(fetchedPolicies);
    } catch (err) {
      console.error('Error fetching SLA policies:', err);
      setError('Failed to load SLA policies. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  const handleEdit = (policy: ISlaPolicy) => {
    if (onEditPolicy) {
      onEditPolicy(policy);
    }
  };

  const handleSetDefault = async (policy: ISlaPolicy) => {
    try {
      await setDefaultSlaPolicy(policy.sla_policy_id);
      await fetchPolicies();
    } catch (err) {
      console.error('Error setting default policy:', err);
      setError('Failed to set default policy. Please try again.');
    }
  };

  const handleDeleteClick = (policy: ISlaPolicy) => {
    setPolicyToDelete(policy);
  };

  const handleConfirmDelete = async () => {
    if (!policyToDelete) return;

    try {
      setIsDeleting(true);
      await deleteSlaPolicy(policyToDelete.sla_policy_id);
      await fetchPolicies();
      setPolicyToDelete(null);
    } catch (err) {
      console.error('Error deleting policy:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete policy. Please try again.';
      setError(errorMessage);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCancelDelete = () => {
    setPolicyToDelete(null);
  };

  const handleRowClick = (policy: ISlaPolicy) => {
    handleEdit(policy);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  // Define column definitions for the DataTable
  const columns: ColumnDefinition<ISlaPolicy>[] = [
    {
      title: 'Name',
      dataIndex: 'policy_name',
    },
    {
      title: 'Description',
      dataIndex: 'description',
      render: (value) => value || '-',
    },
    {
      title: 'Default',
      dataIndex: 'is_default',
      render: (value) => (
        value ? (
          <Badge variant="primary">Default</Badge>
        ) : null
      ),
    },
    {
      title: 'Actions',
      dataIndex: 'sla_policy_id',
      render: (_, record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id={`sla-policy-actions-menu-${record.sla_policy_id}`}
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">Open menu</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id={`edit-sla-policy-${record.sla_policy_id}`}
              onClick={(e) => {
                e.stopPropagation();
                handleEdit(record);
              }}
            >
              Edit
            </DropdownMenuItem>
            {!record.is_default && (
              <DropdownMenuItem
                id={`set-default-sla-policy-${record.sla_policy_id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSetDefault(record);
                }}
              >
                Set as Default
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              id={`delete-sla-policy-${record.sla_policy_id}`}
              className="text-red-600 focus:text-red-600"
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteClick(record);
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingIndicator
          layout="stacked"
          text="Loading SLA policies..."
          spinnerProps={{ size: 'md' }}
        />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>SLA Policies</CardTitle>
        <CardDescription>
          Manage service level agreement policies that define response and resolution time targets
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-md">
            {error}
          </div>
        )}
        <Button
          id="add-sla-policy-button"
          className="mb-4"
          onClick={() => {
            if (onAddPolicy) {
              onAddPolicy();
            }
          }}
        >
          Add Policy
        </Button>
        {policies.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No SLA policies found. Click "Add Policy" to create your first policy.
          </div>
        ) : (
          <DataTable
            id="sla-policies-table"
            data={policies}
            columns={columns}
            onRowClick={handleRowClick}
            pagination={true}
            currentPage={currentPage}
            onPageChange={handlePageChange}
            pageSize={pageSize}
            onItemsPerPageChange={handlePageSizeChange}
          />
        )}
      </CardContent>

      <ConfirmationDialog
        id="delete-sla-policy-dialog"
        isOpen={!!policyToDelete}
        onClose={handleCancelDelete}
        onConfirm={handleConfirmDelete}
        title="Delete SLA Policy"
        message={
          <>
            Are you sure you want to delete the policy{' '}
            <strong>{policyToDelete?.policy_name}</strong>? This action cannot be
            undone.
            {policyToDelete?.is_default && (
              <p className="mt-2 text-amber-600">
                Warning: This is the default policy. You may want to set another
                policy as default first.
              </p>
            )}
          </>
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        isConfirming={isDeleting}
      />
    </Card>
  );
}

export default SlaPolicyList;
