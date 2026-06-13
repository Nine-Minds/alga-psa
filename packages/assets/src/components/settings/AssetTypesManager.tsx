'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { MoreVertical, Plus } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@alga-psa/ui/components/DropdownMenu';
import { IconPicker, getIconComponent } from '@alga-psa/ui/components/IconPicker';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { AssetTypeRegistryEntry, ColumnDefinition } from '@alga-psa/types';
import {
  createAssetTypeAction,
  deleteAssetTypeAction,
  getAssetTypes,
  updateAssetTypeAction,
} from '../../actions/assetTypeRegistryActions';
import {
  validateFieldsSchema,
  type AssetTypeRegistryError,
  type FieldSchemaIssue,
} from '../../lib/assetTypeRegistry';
import AssetTypeSchemaEditor, {
  newSchemaEditorField,
  toEditorFields,
  toFieldsSchema,
  type SchemaEditorField,
} from './AssetTypeSchemaEditor';

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

export function registryErrorMessage(error: AssetTypeRegistryError, t: TranslateFn): string {
  switch (error.code) {
    case 'invalid_name':
      return t('settings.assetTypes.errors.invalidName', {
        defaultValue: 'Enter a name for this asset type.',
      });
    case 'invalid_schema':
      return t('settings.assetTypes.errors.invalidSchema', {
        defaultValue: 'The field schema is invalid. Fix the highlighted fields and try again.',
      });
    case 'reserved_slug':
      return t('settings.assetTypes.errors.reservedSlug', {
        defaultValue: 'The identifier "{{slug}}" is reserved for a built-in type. Choose another name.',
        slug: error.slug,
      });
    case 'slug_conflict':
      return t('settings.assetTypes.errors.slugConflict', {
        defaultValue: 'An asset type with the identifier "{{slug}}" already exists.',
        slug: error.slug,
      });
    case 'not_found':
      return t('settings.assetTypes.errors.notFound', {
        defaultValue: 'This asset type no longer exists.',
      });
    case 'builtin_immutable':
      return t('settings.assetTypes.errors.builtinImmutable', {
        defaultValue: 'Built-in types only allow name and icon changes.',
      });
    case 'builtin_undeletable':
      return t('settings.assetTypes.errors.builtinUndeletable', {
        defaultValue: 'Built-in types cannot be deleted.',
      });
    case 'in_use':
      return t('settings.assetTypes.errors.inUse', {
        defaultValue:
          'This type is still used by {{assetCount}} asset(s). Reassign those assets before deleting it.',
        assetCount: error.asset_count,
      });
    default:
      return t('settings.assetTypes.errors.unknown', { defaultValue: 'Something went wrong.' });
  }
}

const AssetTypesManager: React.FC = () => {
  const { t } = useTranslation('msp/settings');

  const [types, setTypes] = useState<AssetTypeRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingType, setEditingType] = useState<AssetTypeRegistryEntry | null>(null);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [displayOrder, setDisplayOrder] = useState(0);
  const [editorFields, setEditorFields] = useState<SchemaEditorField[]>([]);
  const [schemaIssues, setSchemaIssues] = useState<FieldSchemaIssue[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<AssetTypeRegistryEntry | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchTypes = useCallback(async () => {
    try {
      setLoading(true);
      const entries = await getAssetTypes();
      setTypes(entries);
      setListError(null);
    } catch (error) {
      console.error('Error fetching asset types:', error);
      setListError(
        t('settings.assetTypes.errors.fetchFailed', { defaultValue: 'Failed to load asset types.' })
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchTypes();
  }, [fetchTypes]);

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingType(null);
    setName('');
    setIcon('');
    setDisplayOrder(0);
    setEditorFields([]);
    setSchemaIssues([]);
    setSaveError(null);
    setIsSaving(false);
  };

  const openCreateDialog = () => {
    setEditingType(null);
    setName('');
    setIcon('');
    setDisplayOrder(types.reduce((max, type) => Math.max(max, type.display_order || 0), 0) + 1);
    setEditorFields([]);
    setSchemaIssues([]);
    setSaveError(null);
    setIsDialogOpen(true);
  };

  const openEditDialog = (type: AssetTypeRegistryEntry) => {
    setEditingType(type);
    setName(type.name);
    setIcon(type.icon ?? '');
    setDisplayOrder(type.display_order);
    setEditorFields(toEditorFields(type.fields_schema));
    setSchemaIssues([]);
    setSaveError(null);
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    setSaveError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setSaveError(
        t('settings.assetTypes.errors.invalidName', { defaultValue: 'Enter a name for this asset type.' })
      );
      return;
    }

    if (editingType?.is_builtin) {
      setIsSaving(true);
      try {
        const result = await updateAssetTypeAction(editingType.slug, {
          name: trimmedName,
          icon: icon || null,
        });
        if (result.success) {
          toast.success(t('settings.assetTypes.messages.updated', { defaultValue: 'Asset type updated' }));
          closeDialog();
          await fetchTypes();
        } else {
          setSaveError(registryErrorMessage(result.error, t));
        }
      } catch (error) {
        console.error('Error updating asset type:', error);
        setSaveError(
          t('settings.assetTypes.errors.saveFailed', { defaultValue: 'Failed to save asset type.' })
        );
      } finally {
        setIsSaving(false);
      }
      return;
    }

    const validation = validateFieldsSchema(toFieldsSchema(editorFields));
    if (!validation.valid) {
      setSchemaIssues(validation.issues);
      setSaveError(
        t('settings.assetTypes.errors.invalidSchema', {
          defaultValue: 'The field schema is invalid. Fix the highlighted fields and try again.',
        })
      );
      return;
    }
    setSchemaIssues([]);

    setIsSaving(true);
    try {
      const result = editingType
        ? await updateAssetTypeAction(editingType.slug, {
            name: trimmedName,
            icon: icon || null,
            fields_schema: validation.fields,
            display_order: displayOrder,
          })
        : await createAssetTypeAction({
            name: trimmedName,
            icon: icon || null,
            fields_schema: validation.fields,
            display_order: displayOrder,
          });
      if (result.success) {
        toast.success(
          editingType
            ? t('settings.assetTypes.messages.updated', { defaultValue: 'Asset type updated' })
            : t('settings.assetTypes.messages.created', { defaultValue: 'Asset type created' })
        );
        closeDialog();
        await fetchTypes();
      } else {
        if (result.error.code === 'invalid_schema') {
          setSchemaIssues(result.error.issues);
        }
        setSaveError(registryErrorMessage(result.error, t));
      }
    } catch (error) {
      console.error('Error saving asset type:', error);
      setSaveError(
        t('settings.assetTypes.errors.saveFailed', { defaultValue: 'Failed to save asset type.' })
      );
    } finally {
      setIsSaving(false);
    }
  };

  const resetDelete = () => {
    setDeleteTarget(null);
    setDeleteError(null);
    setIsDeleting(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const result = await deleteAssetTypeAction(deleteTarget.slug);
      if (result.success) {
        toast.success(t('settings.assetTypes.messages.deleted', { defaultValue: 'Asset type deleted' }));
        resetDelete();
        await fetchTypes();
      } else {
        setDeleteError(registryErrorMessage(result.error, t));
      }
    } catch (error) {
      console.error('Error deleting asset type:', error);
      setDeleteError(
        t('settings.assetTypes.errors.deleteFailed', { defaultValue: 'Failed to delete asset type.' })
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const columns: ColumnDefinition<AssetTypeRegistryEntry>[] = [
    {
      title: t('settings.assetTypes.table.name', { defaultValue: 'Name' }),
      dataIndex: 'name',
      render: (value: string, record: AssetTypeRegistryEntry) => {
        const IconComponent = record.icon ? getIconComponent(record.icon) : null;
        return (
          <div className="flex items-center gap-2">
            {IconComponent && <IconComponent className="h-4 w-4 text-gray-600" />}
            <span className="text-gray-700">{value}</span>
            {record.is_builtin && (
              <Badge variant="primary">
                {t('settings.assetTypes.table.builtin', { defaultValue: 'Built-in' })}
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      title: t('settings.assetTypes.table.slug', { defaultValue: 'Identifier' }),
      dataIndex: 'slug',
      render: (value: string) => <span className="text-gray-600 font-mono text-sm">{value}</span>,
    },
    {
      title: t('settings.assetTypes.table.fieldCount', { defaultValue: 'Fields' }),
      dataIndex: 'fields_schema',
      width: '10%',
      render: (value: AssetTypeRegistryEntry['fields_schema']) => (
        <span className="text-gray-600">{value?.length ?? 0}</span>
      ),
    },
    {
      title: t('settings.assetTypes.table.order', { defaultValue: 'Order' }),
      dataIndex: 'display_order',
      width: '10%',
      render: (value: number) => <span className="text-gray-600">{value || 0}</span>,
    },
    {
      title: t('settings.assetTypes.table.actions', { defaultValue: 'Actions' }),
      dataIndex: 'slug',
      width: '10%',
      render: (_: string, record: AssetTypeRegistryEntry) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-8 w-8 p-0"
              id={`assets-types-actions-menu-${record.slug}`}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">
                {t('settings.assetTypes.table.openMenu', { defaultValue: 'Open menu' })}
              </span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id={`assets-types-edit-${record.slug}`}
              onClick={(e) => {
                e.stopPropagation();
                openEditDialog(record);
              }}
            >
              {t('settings.assetTypes.actions.edit', { defaultValue: 'Edit' })}
            </DropdownMenuItem>
            {!record.is_builtin && (
              <DropdownMenuItem
                id={`assets-types-delete-${record.slug}`}
                className="text-destructive focus:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteError(null);
                  setDeleteTarget(record);
                }}
              >
                {t('settings.assetTypes.actions.delete', { defaultValue: 'Delete' })}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-sm">
        <div className="flex items-center justify-center py-8">
          <LoadingIndicator
            layout="stacked"
            text={t('settings.assetTypes.loading', { defaultValue: 'Loading asset types...' })}
            spinnerProps={{ size: 'md' }}
          />
        </div>
      </div>
    );
  }

  const dialogFooter = (
    <div className="flex justify-end space-x-2">
      <Button
        id="assets-types-cancel-button"
        variant="outline"
        onClick={closeDialog}
        disabled={isSaving}
      >
        {t('settings.assetTypes.actions.cancel', { defaultValue: 'Cancel' })}
      </Button>
      <Button id="assets-types-save-button" onClick={handleSave} disabled={isSaving}>
        {editingType
          ? t('settings.assetTypes.actions.save', { defaultValue: 'Save' })
          : t('settings.assetTypes.actions.create', { defaultValue: 'Create' })}
      </Button>
    </div>
  );

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm">
      <h3 className="text-lg font-semibold mb-1 text-gray-800">
        {t('settings.assetTypes.title', { defaultValue: 'Asset Types' })}
      </h3>
      <p className="text-sm text-muted-foreground mb-4">
        {t('settings.assetTypes.description', {
          defaultValue:
            'Manage the asset types available in your asset module. Custom types carry a field schema that drives their create/edit forms.',
        })}
      </p>
      {listError && (
        <Alert variant="destructive" className="mb-4" id="assets-types-list-error">
          <AlertDescription>{listError}</AlertDescription>
        </Alert>
      )}
      <DataTable
        id="assets-types-table"
        data={types}
        columns={columns}
        pagination={false}
      />
      <div className="mt-4">
        <Button
          id="assets-types-add-button"
          onClick={openCreateDialog}
          className="bg-primary-500 text-white hover:bg-primary-600"
        >
          <Plus className="h-4 w-4 mr-2" />
          {t('settings.assetTypes.actions.addType', { defaultValue: 'Add Asset Type' })}
        </Button>
      </div>

      <Dialog
        isOpen={isDialogOpen}
        onClose={closeDialog}
        id="assets-types-dialog"
        className="max-w-2xl"
        title={
          editingType
            ? t('settings.assetTypes.dialog.editTitle', { defaultValue: 'Edit Asset Type' })
            : t('settings.assetTypes.dialog.createTitle', { defaultValue: 'Add Asset Type' })
        }
        footer={dialogFooter}
      >
        <div className="space-y-6">
          {saveError && (
            <Alert variant="destructive" id="assets-types-save-error">
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="assets-types-name-input" className="text-sm font-medium">
              {t('settings.assetTypes.dialog.nameLabel', { defaultValue: 'Name' })}
            </Label>
            <Input
              id="assets-types-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('settings.assetTypes.dialog.namePlaceholder', {
                defaultValue: 'e.g. Firewall',
              })}
              className="w-full"
            />
          </div>

          {!editingType?.is_builtin && (
            <div className="space-y-2">
              <Label htmlFor="assets-types-display-order-input" className="text-sm font-medium">
                {t('settings.assetTypes.dialog.displayOrderLabel', { defaultValue: 'Display Order' })}
              </Label>
              <Input
                id="assets-types-display-order-input"
                type="number"
                min="0"
                value={displayOrder}
                onChange={(e) => setDisplayOrder(parseInt(e.target.value, 10) || 0)}
                className="w-full"
              />
            </div>
          )}

          <div className="space-y-3" id="assets-types-icon-picker">
            <Label className="text-sm font-medium">
              {t('settings.assetTypes.dialog.iconLabel', { defaultValue: 'Icon' })}
            </Label>
            <IconPicker value={icon} onValueChange={setIcon} disabled={isSaving} />
          </div>

          {editingType?.is_builtin ? (
            <div className="space-y-2" id="assets-types-builtin-schema-note">
              <Label className="text-sm font-medium">
                {t('settings.assetTypes.editor.title', { defaultValue: 'Fields' })}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t('settings.assetTypes.dialog.builtinSchemaHint', {
                  defaultValue:
                    'Built-in types use fixed forms managed by AlgaPSA, so their field schema cannot be edited. You can still rename the type or change its icon.',
                })}
              </p>
            </div>
          ) : (
            <AssetTypeSchemaEditor
              fields={editorFields}
              onChange={setEditorFields}
              issues={schemaIssues}
            />
          )}
        </div>
      </Dialog>

      <Dialog
        isOpen={!!deleteTarget}
        onClose={resetDelete}
        id="assets-types-delete-dialog"
        title={t('settings.assetTypes.deleteDialog.title', { defaultValue: 'Delete Asset Type' })}
        footer={
          <div className="flex justify-end space-x-2">
            <Button
              id="assets-types-cancel-delete-button"
              variant="outline"
              onClick={resetDelete}
              disabled={isDeleting}
            >
              {t('settings.assetTypes.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              id="assets-types-confirm-delete-button"
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {t('settings.assetTypes.actions.confirmDelete', { defaultValue: 'Delete' })}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {deleteError && (
            <Alert variant="destructive" id="assets-types-delete-error">
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          )}
          <p className="text-sm text-gray-700">
            {t('settings.assetTypes.deleteDialog.message', {
              defaultValue: 'This permanently removes "{{name}}" from your asset type registry.',
              name: deleteTarget?.name ?? '',
            })}
          </p>
        </div>
      </Dialog>
    </div>
  );
};

export default AssetTypesManager;
