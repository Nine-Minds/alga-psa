import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MoreVertical } from 'lucide-react';

import { Button } from '@alga-psa/ui/components/Button';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@alga-psa/ui/components/DropdownMenu';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import type { ExternalEntityMapping } from '../../actions/externalMappingActions';
import {
  AccountingMappingContext,
  AccountingMappingModule,
  AccountingMappingOverrides
} from './types';
import { AccountingMappingDialog } from './AccountingMappingDialog';
import type { ColumnDefinition } from '@alga-psa/types';

type DisplayMapping = ExternalEntityMapping & {
  algaName?: string;
  externalName?: string;
};

type AccountingMappingModuleViewProps = {
  module: AccountingMappingModule;
  context: AccountingMappingContext;
  realmLabel?: string;
};

export function AccountingMappingModuleView({
  module,
  context,
  realmLabel
}: AccountingMappingModuleViewProps) {
  const overrides = useOverrides(module, context);

  const [mappings, setMappings] = useState<DisplayMapping[]>([]);
  const [algaOptions, setAlgaOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [externalOptions, setExternalOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMapping, setEditingMapping] = useState<DisplayMapping | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = overrides?.loadData
        ? await overrides.loadData(context)
        : await module.load(context);

      setAlgaOptions(result.algaEntities);
      setExternalOptions(result.externalEntities);

      const display = enrichMappings(result.mappings, result.algaEntities, result.externalEntities);
      setMappings(display);
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : 'Failed to load mappings.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [context, module, overrides]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCreateOrUpdate = useCallback(
    async (input: {
      algaEntityId: string;
      externalEntityId: string;
      metadata?: Record<string, unknown> | null;
      mappingId?: string;
    }) => {
      if (input.mappingId) {
        if (overrides?.updateMapping) {
          await overrides.updateMapping(context, input.mappingId, {
            alga_entity_id: input.algaEntityId,
            external_entity_id: input.externalEntityId,
            metadata: input.metadata ?? undefined
          });
        } else {
          await module.update(context, input.mappingId, {
            externalEntityId: input.externalEntityId,
            metadata: input.metadata ?? undefined
          });
        }
      } else {
        if (overrides?.createMapping) {
          await overrides.createMapping(context, {
            integration_type: module.adapterType,
            alga_entity_type: module.algaEntityType,
            alga_entity_id: input.algaEntityId,
            external_entity_id: input.externalEntityId,
            external_realm_id: context.realmId ?? null,
            metadata: input.metadata ?? undefined
          });
        } else {
          await module.create(context, {
            algaEntityId: input.algaEntityId,
            externalEntityId: input.externalEntityId,
            metadata: input.metadata ?? undefined
          });
        }
      }
      await loadData();
    },
    [context, loadData, module, overrides]
  );

  const handleDelete = useCallback(async () => {
    if (!pendingDeleteId) return;
    try {
      if (overrides?.deleteMapping) {
        await overrides.deleteMapping(context, pendingDeleteId);
      } else {
        await module.remove(context, pendingDeleteId);
      }
      setPendingDeleteId(null);
      setConfirmOpen(false);
      await loadData();
    } catch (deleteError) {
      const message =
        deleteError instanceof Error ? deleteError.message : 'Failed to delete mapping.';
      setError(message);
    }
  }, [context, loadData, module, overrides, pendingDeleteId]);

  const columns = useMemo<ColumnDefinition<DisplayMapping>[]>(
    () => [
      {
        title: module.labels.algaColumn,
        dataIndex: 'algaName',
        render: (_value: unknown, record: DisplayMapping) =>
          record.algaName ?? record.alga_entity_id ?? 'N/A'
      },
      {
        title: module.labels.externalColumn,
        dataIndex: 'externalName',
        render: (_value: unknown, record: DisplayMapping) =>
          record.externalName ?? record.external_entity_id ?? 'N/A'
      },
      {
        title: 'Actions',
        dataIndex: 'id',
        sortable: false,
        width: '1%',
        render: (_value: unknown, record: DisplayMapping) => {
          const editMenuId = module.elements?.editMenuPrefix
            ? `${module.elements.editMenuPrefix}${record.id}`
            : undefined;
          const deleteMenuId = module.elements?.deleteMenuPrefix
            ? `${module.elements.deleteMenuPrefix}${record.id}`
            : undefined;

          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  id={`${module.id}-actions-${record.id}`}
                  variant="ghost"
                  className="h-8 w-8 p-0"
                  onClick={(event) => event.stopPropagation()}
                >
                  <span className="sr-only">Open menu</span>
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  id={editMenuId}
                  onClick={(event) => {
                    event.stopPropagation();
                    setEditingMapping(record);
                    setDialogOpen(true);
                  }}
                >
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  id={deleteMenuId}
                  className="text-red-600 focus:text-red-600"
                  onClick={(event) => {
                    event.stopPropagation();
                    setPendingDeleteId(record.id);
                    setConfirmOpen(true);
                  }}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        }
      }
    ],
    [module.labels]
  );

  if (isLoading) {
    return <div>Loading mappings…</div>;
  }

  if (error) {
    return <div className="text-red-600">{error}</div>;
  }

  const deleteMessage = module.labels.deleteConfirmation.message({
    algaName: mappings.find((mapping) => mapping.id === pendingDeleteId)?.algaName,
    externalName: mappings.find((mapping) => mapping.id === pendingDeleteId)?.externalName
  });

  const addButtonId = module.elements?.addButton ?? `${module.id}-add-button`;
  const tableId = module.elements?.table ?? `${module.id}-mappings-table`;
  const deleteDialogPrefix =
    module.elements?.deleteDialogPrefix ?? `${module.id}-delete-dialog`;

  return (
    <div className="space-y-4">
      {module.labels.description && (
        <p className="text-sm text-muted-foreground">{module.labels.description}</p>
      )}
      <div className="flex justify-end">
        <Button
          id={addButtonId}
          onClick={() => {
            setEditingMapping(null);
            setDialogOpen(true);
          }}
        >
          {module.labels.addButton}
        </Button>
      </div>

      {mappings.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No mappings found.
        </div>
      ) : (
        <DataTable
          id={tableId}
          data={mappings}
          columns={columns}
          pagination
        />
      )}

      {dialogOpen ? (
        <AccountingMappingDialog
          module={module}
          context={context}
          isOpen={dialogOpen}
          existingMapping={editingMapping ?? undefined}
          onClose={() => setDialogOpen(false)}
          onSubmit={handleCreateOrUpdate}
          algaEntities={algaOptions}
          externalEntities={externalOptions}
          realmLabel={realmLabel}
        />
      ) : null}

      {confirmOpen && pendingDeleteId ? (
        <ConfirmationDialog
          isOpen={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          onConfirm={handleDelete}
          title={module.labels.deleteConfirmation.title}
          message={deleteMessage}
          confirmLabel={module.labels.deleteConfirmation.confirmLabel ?? 'Delete'}
          cancelLabel={module.labels.deleteConfirmation.cancelLabel ?? 'Cancel'}
          isConfirming={false}
          id={`${deleteDialogPrefix}-${pendingDeleteId!}`}
        />
      ) : null}
    </div>
  );
}

function enrichMappings(
  mappings: ExternalEntityMapping[],
  algaEntities: Array<{ id: string; name: string }>,
  externalEntities: Array<{ id: string; name: string }>
): DisplayMapping[] {
  const algaLookup = new Map(algaEntities.map((entity) => [entity.id, entity.name]));
  const externalLookup = new Map(externalEntities.map((entity) => [entity.id, entity.name]));

  return mappings.map((mapping) => ({
    ...mapping,
    algaName: algaLookup.get(mapping.alga_entity_id),
    externalName: externalLookup.get(mapping.external_entity_id)
  }));
}

function useOverrides(
  module: AccountingMappingModule,
  context: AccountingMappingContext
): AccountingMappingOverrides | undefined {
  return useMemo(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    if (module.resolveOverrides) {
      return module.resolveOverrides(context);
    }

    const globalAny = window as typeof window & {
      __ALGA_PLAYWRIGHT_ACCOUNTING__?: Record<string, any>;
      __ALGA_PLAYWRIGHT_QBO__?: Record<string, any>;
    };

    const genericOverrides =
      globalAny.__ALGA_PLAYWRIGHT_ACCOUNTING__?.[module.adapterType]?.[module.id];
    if (genericOverrides) {
      return genericOverrides;
    }

    if (module.overridesKey) {
      const keyed =
        globalAny.__ALGA_PLAYWRIGHT_ACCOUNTING__?.[module.overridesKey] ??
        globalAny.__ALGA_PLAYWRIGHT_QBO__?.[module.overridesKey];
      if (keyed) {
        return keyed;
      }
    }

    return undefined;
  }, [context, module]);
}
