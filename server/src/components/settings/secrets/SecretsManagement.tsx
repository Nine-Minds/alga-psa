'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Card } from 'server/src/components/ui/Card';
import { DataTable } from 'server/src/components/ui/DataTable';
import type { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import {
  listTenantSecrets,
  deleteSecret,
  getSecretUsage
} from 'server/src/lib/actions/tenant-secret-actions';
import type { TenantSecretMetadata } from '@alga-psa/shared/workflow/secrets';
import { toast } from 'react-hot-toast';
import { Plus, Trash2, Edit, Key, AlertTriangle, Search } from 'lucide-react';
import SecretDialog from './SecretDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from 'server/src/components/ui/Dialog';
import { Input } from 'server/src/components/ui/Input';

export default function SecretsManagement() {
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
      console.error('Failed to load secrets:', error);
      toast.error('Failed to load secrets');
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
      toast.success(`Secret "${secretToDelete.name}" deleted`);
      setDeleteDialogOpen(false);
      setSecretToDelete(null);
      await loadSecrets();
    } catch (error) {
      console.error('Failed to delete secret:', error);
      toast.error('Failed to delete secret');
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
      title: 'Name',
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
      title: 'Description',
      dataIndex: 'description',
      width: '30%',
      render: (value: string | undefined) => (
        <span className="text-gray-600">{value || '-'}</span>
      ),
    },
    {
      title: 'Last Updated',
      dataIndex: 'updatedAt',
      width: '20%',
      render: (value: string) => new Date(value).toLocaleString(),
    },
    {
      title: 'Last Accessed',
      dataIndex: 'lastAccessedAt',
      width: '15%',
      render: (value: string | undefined) => value ? new Date(value).toLocaleString() : 'Never',
    },
    {
      title: 'Actions',
      dataIndex: 'actions',
      width: '10%',
      render: (_: unknown, record: TenantSecretMetadata) => (
        <div className="flex items-center gap-2">
          <Button
            id={`edit-secret-${record.name}`}
            variant="ghost"
            size="sm"
            onClick={() => handleEdit(record)}
            title="Edit secret"
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            id={`delete-secret-${record.name}`}
            variant="ghost"
            size="sm"
            onClick={() => handleDeleteClick(record)}
            title="Delete secret"
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    }
  ], []);

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-semibold">Secrets</h2>
            <p className="text-sm text-gray-500 mt-1">
              Manage secrets for use in workflows. Secrets are encrypted and can be referenced using{' '}
              <code className="bg-gray-100 px-1 rounded">{'{ $secret: "SECRET_NAME" }'}</code>
            </p>
          </div>
          <Button
            id="create-secret-button"
            onClick={handleCreate}
          >
            <Plus className="h-4 w-4 mr-2" />
            Create Secret
          </Button>
        </div>

        {/* Search/Filter */}
        <div className="mb-4">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              id="secrets-search"
              placeholder="Search secrets..."
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
        title="Delete Secret"
      >
        <DialogContent>
          {secretToDelete && (
            <div className="space-y-4">
              <p>
                Are you sure you want to delete the secret{' '}
                <code className="bg-gray-100 px-2 py-0.5 rounded font-mono">{secretToDelete.name}</code>?
              </p>

              {getUsageForSecret(secretToDelete.name).length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-amber-800">
                        This secret is used by {getUsageForSecret(secretToDelete.name).length} workflow(s)
                      </p>
                      <p className="text-sm text-amber-700 mt-1">
                        Deleting it will cause those workflows to fail when they try to access this secret.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <p className="text-sm text-gray-500">
                This action cannot be undone.
              </p>

              {/* Require typing secret name to confirm */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">
                  Type <code className="bg-gray-100 px-1 rounded font-mono text-sm">{secretToDelete.name}</code> to confirm:
                </label>
                <Input
                  id="delete-confirm-name"
                  value={deleteConfirmName}
                  onChange={(e) => setDeleteConfirmName(e.target.value)}
                  placeholder="Enter secret name"
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
                  Cancel
                </Button>
                <Button
                  id="confirm-delete-secret"
                  variant="destructive"
                  onClick={handleDeleteConfirm}
                  disabled={deleting || deleteConfirmName !== secretToDelete.name}
                >
                  {deleting ? 'Deleting...' : 'Delete Secret'}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
