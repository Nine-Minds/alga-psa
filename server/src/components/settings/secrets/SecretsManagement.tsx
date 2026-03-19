'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import type { ColumnDefinition } from '@alga-psa/types';
import {
  listTenantSecrets,
  deleteSecret,
  getSecretUsage
} from '@alga-psa/tenancy/actions';
import type { TenantSecretMetadata } from '@alga-psa/workflows/secrets';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { Plus, Trash2, Edit, Key, AlertTriangle, Search } from 'lucide-react';
import SecretDialog from './SecretDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export default function SecretsManagement() {
  const { t } = useTranslation('msp/settings');
  const [secrets, setSecrets] = useState<TenantSecretMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSecret, setEditingSecret] = useState<TenantSecretMetadata | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [secretToDelete, setSecretToDelete] = useState<TenantSecretMetadata | null>(null);
  const [secretUsage, setSecretUsage] = useState<Map<string, string[]>>(new Map());
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');

  // Search/filter state
  const [searchQuery, setSearchQuery] = useState('');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Filter secrets based on search query
  const filteredSecrets = useMemo(() => {
    if (!searchQuery.trim()) return secrets;
    const query = searchQuery.toLowerCase();
    return secrets.filter(s =>
      s.name.toLowerCase().includes(query) ||
      (s.description?.toLowerCase().includes(query) ?? false)
    );
  }, [secrets, searchQuery]);

  const loadSecrets = useCallback(async () => {
    try {
      setLoading(true);
      const [secretsData, usageData] = await Promise.all([
        listTenantSecrets(),
        getSecretUsage()
      ]);
      setSecrets(secretsData);
      setSecretUsage(usageData);
    } catch (error) {
      handleError(error, t('secrets.messages.error.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSecrets();
  }, [loadSecrets]);

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  const handleCreate = () => {
    setEditingSecret(null);
    setDialogOpen(true);
  };

  const handleEdit = (secret: TenantSecretMetadata) => {
    setEditingSecret(secret);
    setDialogOpen(true);
  };

  const handleDeleteClick = (secret: TenantSecretMetadata) => {
    setSecretToDelete(secret);
    setDeleteConfirmName('');
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!secretToDelete) return;

    try {
      setDeleting(true);
      await deleteSecret(secretToDelete.name);
      toast.success(t('secrets.messages.success.deleted', { name: secretToDelete.name }));
      setDeleteDialogOpen(false);
      setSecretToDelete(null);
      await loadSecrets();
    } catch (error) {
      handleError(error, t('secrets.messages.error.deleteFailed'));
    } finally {
      setDeleting(false);
    }
  };

  const handleDialogSuccess = async () => {
    setDialogOpen(false);
    setEditingSecret(null);
    await loadSecrets();
  };

  const getUsageForSecret = (secretName: string): string[] => {
    return secretUsage.get(secretName) ?? [];
  };

  const columns: ColumnDefinition<TenantSecretMetadata>[] = useMemo(() => [
    {
      title: t('secrets.list.table.name'),
      dataIndex: 'name',
      width: '25%',
      render: (value: string) => (
        <div className="flex items-center gap-2">
          <Key className="h-4 w-4 text-gray-400" />
          <code className="text-sm font-mono bg-gray-100 px-2 py-0.5 rounded">{value}</code>
        </div>
      ),
    },
    {
      title: t('secrets.list.table.description'),
      dataIndex: 'description',
      width: '30%',
      render: (value: string | undefined) => (
        <span className="text-gray-600">{value || t('secrets.list.table.empty')}</span>
      ),
    },
    {
      title: t('secrets.list.table.lastUpdated'),
      dataIndex: 'updatedAt',
      width: '20%',
      render: (value: string) => new Date(value).toLocaleString(),
    },
    {
      title: t('secrets.list.table.lastAccessed'),
      dataIndex: 'lastAccessedAt',
      width: '15%',
      render: (value: string | undefined) => value ? new Date(value).toLocaleString() : t('secrets.list.table.never'),
    },
    {
      title: t('secrets.list.table.actions'),
      dataIndex: 'actions',
      width: '10%',
      render: (_: unknown, record: TenantSecretMetadata) => (
        <div className="flex items-center gap-2">
          <Button
            id={`edit-secret-${record.name}`}
            variant="ghost"
            size="sm"
            onClick={() => handleEdit(record)}
            title={t('secrets.list.tooltips.edit')}
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            id={`delete-secret-${record.name}`}
            variant="ghost"
            size="sm"
            onClick={() => handleDeleteClick(record)}
            title={t('secrets.list.tooltips.delete')}
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    }
  ], [t]);

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-semibold">{t('secrets.list.title')}</h2>
            <p className="text-sm text-gray-500 mt-1">
              {t('secrets.list.description')}
            </p>
          </div>
          <Button
            id="create-secret-button"
            onClick={handleCreate}
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('secrets.list.createSecret')}
          </Button>
        </div>

        {/* Search/Filter */}
        <div className="mb-4">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              id="secrets-search"
              placeholder={t('secrets.list.search')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        <DataTable
          id="secrets-table"
          data={filteredSecrets}
          columns={columns}
          pagination={true}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          pageSize={pageSize}
          onItemsPerPageChange={handlePageSizeChange}
        />
      </Card>

      <SecretDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        secret={editingSecret}
        onSuccess={handleDialogSuccess}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog
        isOpen={deleteDialogOpen}
        onClose={() => !deleting && setDeleteDialogOpen(false)}
        title={t('secrets.dialog.deleteTitle')}
      >
        <DialogContent>
          {secretToDelete && (
            <div className="space-y-4">
              <p>
                {t('secrets.dialog.delete.confirmation', { name: secretToDelete.name })}
              </p>

              {getUsageForSecret(secretToDelete.name).length > 0 && (
                <div className="p-3 bg-warning/10 border border-warning/30 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-[rgb(var(--color-text-800))]">
                        {t('secrets.dialog.delete.usedByWorkflows', { count: getUsageForSecret(secretToDelete.name).length })}
                      </p>
                      <p className="text-sm text-[rgb(var(--color-text-700))]">
                        {t('secrets.dialog.delete.usedByWarning')}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <p className="text-sm text-gray-500">
                {t('secrets.dialog.delete.cannotUndo')}
              </p>

              {/* Require typing secret name to confirm */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">
                  {t('secrets.dialog.delete.typeToConfirm', { name: secretToDelete.name })}
                </label>
                <Input
                  id="delete-confirm-name"
                  value={deleteConfirmName}
                  onChange={(e) => setDeleteConfirmName(e.target.value)}
                  placeholder={t('secrets.dialog.delete.placeholder')}
                  disabled={deleting}
                  className="font-mono"
                />
              </div>

              <DialogFooter>
                <Button
                  id="cancel-delete-secret"
                  variant="outline"
                  onClick={() => setDeleteDialogOpen(false)}
                  disabled={deleting}
                >
                  {t('secrets.dialog.actions.cancel')}
                </Button>
                <Button
                  id="confirm-delete-secret"
                  variant="destructive"
                  onClick={handleDeleteConfirm}
                  disabled={deleting || deleteConfirmName !== secretToDelete.name}
                >
                  {deleting ? t('secrets.dialog.actions.deleting') : t('secrets.dialog.actions.delete')}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
