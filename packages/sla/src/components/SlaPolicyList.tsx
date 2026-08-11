'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { ISlaPolicy } from '../types';
import { getSlaPolicies, deleteSlaPolicy, setDefaultSlaPolicy, getSlaPolicyUsage } from '../actions';
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
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  type ActionMessageError,
  type ActionPermissionError,
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

interface SlaPolicyListProps {
  onEditPolicy?: (policy: ISlaPolicy) => void;
  onAddPolicy?: () => void;
}

const isReturnedActionError = (value: unknown): value is ActionMessageError | ActionPermissionError =>
  isActionMessageError(value) || isActionPermissionError(value);

export function SlaPolicyList({ onEditPolicy, onAddPolicy }: SlaPolicyListProps) {
  const { t } = useTranslation('msp/settings');
  const [policies, setPolicies] = useState<ISlaPolicy[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [policyToDelete, setPolicyToDelete] = useState<ISlaPolicy | null>(null);
  const [policyUsage, setPolicyUsage] = useState<{
    boards: { board_id: string; name: string }[];
    clients: { client_id: string; client_name: string }[];
    ticketCount: number;
  } | null>(null);
  const [isLoadingUsage, setIsLoadingUsage] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const fetchPolicies = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const fetchedPolicies = await getSlaPolicies();
      setPolicies(fetchedPolicies);
    } catch (err) {
      console.error('Error fetching SLA policies:', err);
      setError(t('sla.policyList.errors.loadFailed', { defaultValue: 'Failed to load SLA policies. Please try again.' }));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

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
      const result = await setDefaultSlaPolicy(policy.sla_policy_id);
      if (isReturnedActionError(result)) {
        setError(getErrorMessage(result));
        return;
      }

      await fetchPolicies();
    } catch (err) {
      console.error('Error setting default policy:', err);
      setError(t('sla.policyList.errors.setDefaultFailed', { defaultValue: 'Failed to set default policy. Please try again.' }));
    }
  };

  const handleDeleteClick = async (policy: ISlaPolicy) => {
    setPolicyToDelete(policy);
    setPolicyUsage(null);
    setIsLoadingUsage(true);
    try {
      const usage = await getSlaPolicyUsage(policy.sla_policy_id);
      setPolicyUsage(usage);
    } catch (err) {
      console.error('Error fetching policy usage:', err);
      setPolicyUsage({ boards: [], clients: [], ticketCount: 0 });
    } finally {
      setIsLoadingUsage(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!policyToDelete) return;

    try {
      setIsDeleting(true);
      const result = await deleteSlaPolicy(policyToDelete.sla_policy_id);
      if (isReturnedActionError(result)) {
        setError(getErrorMessage(result));
        return;
      }

      await fetchPolicies();
      setPolicyToDelete(null);
    } catch (err) {
      console.error('Error deleting policy:', err);
      const errorMessage = err instanceof Error
        ? err.message
        : t('sla.policyList.errors.deleteFailed', { defaultValue: 'Failed to delete policy. Please try again.' });
      setError(errorMessage);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCancelDelete = () => {
    setPolicyToDelete(null);
    setPolicyUsage(null);
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
      title: t('sla.policyList.columns.name', { defaultValue: 'Name' }),
      dataIndex: 'policy_name',
    },
    {
      title: t('sla.policyList.columns.description', { defaultValue: 'Description' }),
      dataIndex: 'description',
      render: (value) => value || '-',
    },
    {
      title: t('sla.policyList.defaultLabel', { defaultValue: 'Default' }),
      dataIndex: 'is_default',
      render: (value) => (
        value ? (
          <Badge variant="primary">{t('sla.policyList.defaultLabel', { defaultValue: 'Default' })}</Badge>
        ) : null
      ),
    },
    {
      title: t('sla.policyList.columns.actions', { defaultValue: 'Actions' }),
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
              <span className="sr-only">{t('sla.policyList.actions.openMenu', { defaultValue: 'Open menu' })}</span>
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
              {t('sla.policyList.actions.edit', { defaultValue: 'Edit' })}
            </DropdownMenuItem>
            {!record.is_default && (
              <DropdownMenuItem
                id={`set-default-sla-policy-${record.sla_policy_id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSetDefault(record);
                }}
              >
                {t('sla.policyList.actions.setDefault', { defaultValue: 'Set as Default' })}
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
              {t('sla.policyList.actions.delete', { defaultValue: 'Delete' })}
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
          text={t('sla.policyList.loading', { defaultValue: 'Loading SLA policies...' })}
          spinnerProps={{ size: 'md' }}
        />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('sla.policyList.title', { defaultValue: 'SLA Policies' })}</CardTitle>
        <CardDescription>
          {t('sla.policyList.description', { defaultValue: 'Manage service level agreement policies that define response and resolution time targets' })}
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
          {t('sla.policyList.addPolicy', { defaultValue: 'Add Policy' })}
        </Button>
        {policies.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {t('sla.policyList.empty', { defaultValue: 'No SLA policies found. Click "Add Policy" to create your first policy.' })}
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
        title={t('sla.policyList.delete.title', { defaultValue: 'Delete SLA Policy' })}
        message={
          <>
            {t('sla.policyList.delete.confirm', {
              defaultValue: 'Are you sure you want to delete the policy {{name}}? This action cannot be undone.',
              name: policyToDelete?.policy_name ?? ''
            })}
            {policyToDelete?.is_default && (
              <Alert variant="warning" className="mt-3">
                <AlertDescription>
                  {t('sla.policyList.delete.defaultWarning', { defaultValue: 'This is the default policy. You may want to set another policy as default first.' })}
                </AlertDescription>
              </Alert>
            )}
            {isLoadingUsage && (
              <p className="mt-2 text-sm text-muted-foreground">{t('sla.policyList.delete.checkingUsage', { defaultValue: 'Checking usage...' })}</p>
            )}
            {policyUsage && (policyUsage.boards.length > 0 || policyUsage.clients.length > 0 || policyUsage.ticketCount > 0) && (
              <Alert variant="warning" className="mt-3">
                <AlertTitle>{t('sla.policyList.delete.inUseTitle', { defaultValue: 'This policy is currently in use' })}</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc list-inside space-y-0.5 mt-1">
                    {policyUsage.boards.length > 0 && (
                      <li>
                        {t('sla.policyList.delete.usageBoards', {
                          defaultValue_one: 'Board: {{names}}',
                          defaultValue_other: 'Boards: {{names}}',
                          count: policyUsage.boards.length,
                          names: policyUsage.boards.map(b => b.name).join(', ')
                        })}
                      </li>
                    )}
                    {policyUsage.clients.length > 0 && (
                      <li>
                        {t('sla.policyList.delete.usageClients', {
                          defaultValue_one: 'Client: {{names}}',
                          defaultValue_other: 'Clients: {{names}}',
                          count: policyUsage.clients.length,
                          names: policyUsage.clients.map(c => c.client_name).join(', ')
                        })}
                      </li>
                    )}
                    {policyUsage.ticketCount > 0 && (
                      <li>
                        {t('sla.policyList.delete.usageTickets', {
                          defaultValue_one: '{{count}} ticket',
                          defaultValue_other: '{{count}} tickets',
                          count: policyUsage.ticketCount
                        })}
                      </li>
                    )}
                  </ul>
                  <p className="mt-1.5">
                    {t('sla.policyList.delete.unlinkNote', { defaultValue: 'These references will be unlinked. Existing SLA tracking data on tickets will be preserved.' })}
                  </p>
                </AlertDescription>
              </Alert>
            )}
          </>
        }
        confirmLabel={t('sla.policyList.actions.delete', { defaultValue: 'Delete' })}
        cancelLabel={t('sla.policyList.actions.cancel', { defaultValue: 'Cancel' })}
        isConfirming={isDeleting || isLoadingUsage}
      />
    </Card>
  );
}

export default SlaPolicyList;
