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
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { preCheckDeletion } from '@alga-psa/auth/lib/preCheckDeletion';
import {
  handleError,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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

  const handleUpdateRole = async () => {
    if (editingRole) {
      try {
        const result = await updateRole(editingRole.role_id, editingRole.role_name);
        if (isReturnedActionError(result)) {
          handleError(result);
          return;
        }
        setEditingRole(null);
        fetchRoles();
      } catch (error) {
        handleError(error, t('roleManagement.errors.updateFailed'));
      }
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
      dataIndex: 'role_id',
      width: '150px',
      render: (roleId, role) => {
        const isAdminRole = role.role_name.toLowerCase() === 'admin';
        const button = (
          <Button
            variant="destructive"
            id="delete-role-button"
            size="sm"
            onClick={() => handleDeleteRole(role)}
            disabled={isAdminRole}
          >
            {t('common:common.delete')}
          </Button>
        );

        if (isAdminRole) {
          return (
            <Tooltip content={t('roleManagement.adminDeleteDisabled')}>
              <span>{button}</span>
            </Tooltip>
          );
        }
        
        return button;
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
