'use client';

// Auth-owned role management UI.

import { useState, useEffect, useCallback } from 'react';
import { Flex, Text } from '@radix-ui/themes';
import { Button } from '@alga-psa/ui/components/Button';
import { DeleteEntityDialog } from '@alga-psa/ui';
import { createRole, updateRole, deleteRole, getRoles } from '../../../actions/policyActions';
import { IRole, DeletionValidationResult } from '@alga-psa/types';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from '@alga-psa/types';
import GenericDialog from '@alga-psa/ui/components/GenericDialog';
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import { MoreVertical } from 'lucide-react';
import { preCheckDeletion } from '@alga-psa/auth/lib/preCheckDeletion';
import {
  handleError,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { isBuiltInRoleName } from '../../../lib/policy/builtInRoles';

const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

export default function RoleManagement() {
  const { t } = useTranslation(['msp/settings', 'common']);
  const [roles, setRoles] = useState<IRole[]>([]);
  const [newRole, setNewRole] = useState({ 
    role_name: '', 
    description: '',
    msp: true,
    client: false
  });
  const [editingRole, setEditingRole] = useState<IRole | null>(null);
  const [editForm, setEditForm] = useState({ role_name: '', description: '' });
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [roleToDelete, setRoleToDelete] = useState<IRole | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteValidation, setDeleteValidation] = useState<DeletionValidationResult | null>(null);
  const [isDeleteValidating, setIsDeleteValidating] = useState(false);
  const [isDeleteProcessing, setIsDeleteProcessing] = useState(false);

  const resetDeleteState = useCallback(() => {
    setIsDeleteDialogOpen(false);
    setRoleToDelete(null);
    setDeleteValidation(null);
    setIsDeleteValidating(false);
    setIsDeleteProcessing(false);
  }, []);

  useEffect(() => {
    fetchRoles();
  }, []);

  const fetchRoles = async () => {
    const fetchedRoles = await getRoles();
    // Sort roles alphabetically by role_name
    const sortedRoles = fetchedRoles.sort((a, b) => a.role_name.localeCompare(b.role_name));
    setRoles(sortedRoles);
  };

  const handleCreateRole = async () => {
    try {
      const result = await createRole(newRole.role_name, newRole.description, newRole.msp, newRole.client);
      if (isReturnedActionError(result)) {
        handleError(result);
        return;
      }
      setNewRole({
        role_name: '',
        description: '',
        msp: true,
        client: false
      });
      setIsCreateDialogOpen(false);
      fetchRoles();
    } catch (error) {
      handleError(error, t('roleManagement.errors.createFailed'));
    }
  };

  const openEditDialog = (role: IRole) => {
    setEditingRole(role);
    setEditForm({ role_name: role.role_name, description: role.description ?? '' });
  };

  const closeEditDialog = () => {
    setEditingRole(null);
    setIsSavingEdit(false);
  };

  const handleUpdateRole = async () => {
    if (!editingRole) {
      return;
    }
    setIsSavingEdit(true);
    try {
      const result = await updateRole(editingRole.role_id, {
        ...(isBuiltInRoleName(editingRole.role_name) ? {} : { role_name: editForm.role_name }),
        description: editForm.description,
      });
      if (isReturnedActionError(result)) {
        handleError(result);
        return;
      }
      closeEditDialog();
      fetchRoles();
    } catch (error) {
      handleError(error, t('roleManagement.errors.updateFailed'));
    } finally {
      setIsSavingEdit(false);
    }
  };

  const runDeleteValidation = useCallback(async (roleId: string) => {
    setIsDeleteValidating(true);
    try {
      const result = await preCheckDeletion('role', roleId);
      setDeleteValidation(result);
    } catch (error) {
      console.error('Failed to validate role deletion:', error);
      setDeleteValidation({
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: t('roleManagement.errors.validateDeletionFailed'),
        dependencies: [],
        alternatives: []
      });
    } finally {
      setIsDeleteValidating(false);
    }
  }, []);

  const handleDeleteRole = (role: IRole) => {
    setRoleToDelete(role);
    setDeleteValidation(null);
    setIsDeleteDialogOpen(true);
    void runDeleteValidation(role.role_id);
  };

  const handleConfirmDelete = async () => {
    if (!roleToDelete) {
      return;
    }
    setIsDeleteProcessing(true);
    try {
      const result = await deleteRole(roleToDelete.role_id);
      if (result.success) {
        await fetchRoles();
        resetDeleteState();
        return;
      }
      setDeleteValidation(result);
    } catch (error) {
      console.error('Error deleting role:', error);
      setDeleteValidation({
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: error instanceof Error ? error.message : t('roleManagement.errors.deleteFailed'),
        dependencies: [],
        alternatives: []
      });
    } finally {
      setIsDeleteProcessing(false);
    }
  };

  const columns: ColumnDefinition<IRole>[] = [
    {
      title: t('roleManagement.columns.roleNameRequired'),
      dataIndex: 'role_name',
    },
    {
      title: t('roleManagement.fields.description'),
      dataIndex: 'description',
    },
    {
      title: t('roleManagement.columns.portal'),
      dataIndex: 'role_id',
      width: '150px',
      render: (_, record) => {
        const portals: string[] = [];
        if (record.msp) portals.push(t('roleManagement.portal.mspShort'));
        if (record.client) portals.push(t('roleManagement.portal.clientShort'));
        return (
          <span className="text-sm">
            {portals.join(', ') || t('roleManagement.portal.none')}
          </span>
        );
      }
    },
    {
      title: t('common:common.actions'),
      id: 'actions',
      dataIndex: 'role_id',
      sortable: false,
      width: '64px',
      render: (roleId: string, role: IRole) => {
        const isAdminRole = role.role_name.toLowerCase() === 'admin';
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button id={`role-actions-${roleId}`} variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">{t('common:actions.openMenu')}</span>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem id={`edit-role-${roleId}`} onClick={() => openEditDialog(role)}>
                {t('common:common.edit')}
              </DropdownMenuItem>
              <DropdownMenuItem
                id={`delete-role-${roleId}`}
                className="text-destructive focus:text-destructive"
                disabled={isAdminRole}
                title={isAdminRole ? t('roleManagement.adminDeleteDisabled') : undefined}
                onClick={() => handleDeleteRole(role)}
              >
                {t('common:common.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      }
    }
  ];

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t('roleManagement.title')}</CardTitle>
              <CardDescription>
                {t('roleManagement.description')}
              </CardDescription>
            </div>
            <Button 
              id="create-role-btn" 
              onClick={() => setIsCreateDialogOpen(true)}
            >
              {t('roleManagement.actions.addRole')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            id="roles-table"
            data={roles}
            columns={columns}
            pagination={false}
            pageSize={999}
          />
        </CardContent>
      </Card>

      {/* Create Role Dialog */}
      <GenericDialog
        isOpen={isCreateDialogOpen}
        onClose={() => {
          setIsCreateDialogOpen(false);
          setNewRole({ 
            role_name: '', 
            description: '',
            msp: true,
            client: false
          });
        }}
        title={t('roleManagement.createDialog.title')}
        id="create-role-dialog"
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="role-name">{t('roleManagement.fields.roleName')}</Label>
            <Input
              id="role-name"
              type="text"
              placeholder={t('roleManagement.fields.roleNamePlaceholder')}
              value={newRole.role_name}
              onChange={(e) => setNewRole({ ...newRole, role_name: e.target.value })}
            />
          </div>
          
          <div>
            <Label htmlFor="role-description">{t('roleManagement.fields.description')}</Label>
            <TextArea
              id="role-description"
              placeholder={t('roleManagement.fields.descriptionPlaceholder')}
              value={newRole.description}
              onChange={(e) => setNewRole({ ...newRole, description: e.target.value })}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('roleManagement.portal.access')}</Label>
            <div className="space-y-2">
              <label className="flex items-center space-x-2">
                <Checkbox
                  checked={newRole.msp}
                  onChange={(e) => 
                    setNewRole({ ...newRole, msp: e.target.checked })
                  }
                />
                <span>{t('roleManagement.portal.msp')}</span>
              </label>
              <label className="flex items-center space-x-2">
                <Checkbox
                  checked={newRole.client}
                  onChange={(e) => 
                    setNewRole({ ...newRole, client: e.target.checked })
                  }
                />
                <span>{t('roleManagement.portal.client')}</span>
              </label>
            </div>
            <p className="text-sm text-gray-500">
              {t('roleManagement.portal.required')}
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button
              id="cancel-create-role-btn"
              variant="outline"
              onClick={() => {
                setIsCreateDialogOpen(false);
                setNewRole({ 
                  role_name: '', 
                  description: '',
                  msp: true,
                  client: false
                });
              }}
            >
              {t('common:common.cancel')}
            </Button>
            <Button
              id="confirm-create-role-btn"
              onClick={handleCreateRole}
              disabled={!newRole.role_name || (!newRole.msp && !newRole.client)}
            >
              {t('roleManagement.actions.createRole')}
            </Button>
          </div>
        </div>
      </GenericDialog>

      <GenericDialog
        isOpen={editingRole !== null}
        onClose={closeEditDialog}
        title={t('roleManagement.editDialog.title')}
        id="edit-role-dialog"
      >
        {editingRole && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-role-name">{t('roleManagement.fields.roleName')}</Label>
              <Input
                id="edit-role-name"
                type="text"
                value={editForm.role_name}
                disabled={isBuiltInRoleName(editingRole.role_name)}
                onChange={(e) => setEditForm({ ...editForm, role_name: e.target.value })}
              />
              {isBuiltInRoleName(editingRole.role_name) && (
                <p className="mt-1 text-sm text-gray-500">{t('roleManagement.editDialog.builtInNameLocked')}</p>
              )}
            </div>

            <div>
              <Label htmlFor="edit-role-description">{t('roleManagement.fields.description')}</Label>
              <TextArea
                id="edit-role-description"
                placeholder={t('roleManagement.fields.descriptionPlaceholder')}
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                rows={3}
              />
            </div>

            <div>
              <Label>{t('roleManagement.portal.access')}</Label>
              <p className="text-sm">
                {[
                  editingRole.msp && t('roleManagement.portal.msp'),
                  editingRole.client && t('roleManagement.portal.client'),
                ].filter(Boolean).join(', ') || t('roleManagement.portal.none')}
              </p>
              <p className="text-sm text-gray-500">{t('roleManagement.editDialog.portalLocked')}</p>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button id="cancel-edit-role-btn" variant="outline" onClick={closeEditDialog}>
                {t('common:common.cancel')}
              </Button>
              <Button
                id="confirm-edit-role-btn"
                onClick={handleUpdateRole}
                disabled={!editForm.role_name.trim() || isSavingEdit}
              >
                {isSavingEdit ? t('common:actions.saving') : t('common:common.save')}
              </Button>
            </div>
          </div>
        )}
      </GenericDialog>

      <DeleteEntityDialog
        id={roleToDelete ? `delete-role-${roleToDelete.role_id}` : 'delete-role-dialog'}
        isOpen={isDeleteDialogOpen}
        onClose={resetDeleteState}
        onConfirmDelete={handleConfirmDelete}
        entityName={roleToDelete?.role_name || t('roleManagement.deleteDialog.entityFallback')}
        validationResult={deleteValidation}
        isValidating={isDeleteValidating}
        isDeleting={isDeleteProcessing}
      />
    </>
  );
}
