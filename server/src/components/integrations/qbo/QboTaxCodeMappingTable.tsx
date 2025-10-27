// server/src/components/integrations/qbo/QboTaxCodeMappingTable.tsx
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getPaginationRowModel,
} from '@tanstack/react-table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from 'server/src/components/ui/Table';
import { Button } from 'server/src/components/ui/Button';
import { MoreVertical } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from 'server/src/components/ui/DropdownMenu';
import { getExternalEntityMappings, deleteExternalEntityMapping } from '@product/actions/externalMappingActions';
// Use existing action for Alga Tax Regions
import { getTaxRegions } from '@product/actions/taxSettingsActions'; // Corrected import
import { ITaxRegion } from 'server/src/interfaces/tax.interfaces'; // Import the correct type
import { getQboTaxCodes } from '@product/actions/integrations/qboActions'; // TODO: Create this action
import { QboMappingFormDialog } from './QboMappingFormDialog';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';

// Placeholder Type for QBO TaxCode (Refine based on actual action return types)
interface QboTaxCode { // TODO: Define in qboActions.ts
  id: string; // QBO TaxCodeRef.value
  name: string;
}

// Use the actual type structure from the action file
interface ExternalEntityMapping {
  id: string; // UUID
  tenant: string; // UUID
  integration_type: string; // VARCHAR(50)
  alga_entity_type: string; // VARCHAR(50)
  alga_entity_id: string; // VARCHAR(255)
  external_entity_id: string; // VARCHAR(255)
  external_realm_id?: string | null; // VARCHAR(255)
  sync_status?: 'synced' | 'pending' | 'error' | 'manual_link' | null; // VARCHAR(20)
  last_synced_at?: string | null; // TIMESTAMPTZ (ISO8601 String)
  metadata?: object | null; // JSONB
  created_at: string; // TIMESTAMPTZ (ISO8601 String)
  updated_at: string; // TIMESTAMPTZ (ISO8601 String)
}

// Combined type for display
interface DisplayMapping extends ExternalEntityMapping {
  algaEntityName?: string;
  externalEntityName?: string;
}

interface QboTaxCodeMappingTableProps {
  realmId: string;
  // Removed tenantId prop
}

export function QboTaxCodeMappingTable({ realmId }: QboTaxCodeMappingTableProps) {
  const [mappings, setMappings] = useState<DisplayMapping[]>([]);
  const [algaEntities, setAlgaEntities] = useState<ITaxRegion[]>([]); // Use ITaxRegion type
  const [qboEntities, setQboEntities] = useState<QboTaxCode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingMapping, setEditingMapping] = useState<DisplayMapping | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [deletingMappingId, setDeletingMappingId] = useState<string | null>(null);

  const algaEntityType = 'tax_region'; // Specific to this table - ADJUST IF NEEDED
  const externalEntityType = 'TaxCode'; // Specific to QBO Tax Codes

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [mappingData, algaData, qboData] = await Promise.all([
        getExternalEntityMappings({
          integrationType: 'quickbooks_online',
          algaEntityType: algaEntityType,
          externalRealmId: realmId,
        }),
        getTaxRegions(), // Use existing action (tenant handled internally)
        getQboTaxCodes(), // Fetches based on current user context internally
      ]);

      // Use ITaxRegion type and properties
      const currentAlgaEntities: ITaxRegion[] = algaData || [];
      const currentQboEntities: QboTaxCode[] = qboData || [];
      setAlgaEntities(currentAlgaEntities);
      setQboEntities(currentQboEntities);

      const displayMappings = (mappingData || []).map((m: ExternalEntityMapping): DisplayMapping => ({
        ...m,
        // Use region_code as ID and region_name as Name from ITaxRegion
        algaEntityName: currentAlgaEntities.find((a: ITaxRegion) => a.region_code === m.alga_entity_id)?.region_name || m.alga_entity_id,
        externalEntityName: currentQboEntities.find((q: QboTaxCode) => q.id === m.external_entity_id)?.name || m.external_entity_id,
      }));
      setMappings(displayMappings);

    } catch (err: any) {
      console.error('Error fetching QBO Tax Code mapping data:', err);
      setError('Failed to load tax code mappings. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [realmId]); // Removed tenantId from dependency array

  const handleEdit = (mapping: DisplayMapping) => {
    setEditingMapping(mapping);
    setIsFormOpen(true);
  };

  const handleDeleteRequest = (mappingId: string) => {
    setDeletingMappingId(mappingId);
    setIsDeleteConfirmOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingMappingId) return;
    setIsLoading(true);
    setError(null);
    try {
      await deleteExternalEntityMapping(deletingMappingId);
      fetchData();
    } catch (err: any) {
      setError(`Failed to delete mapping: ${err.message || 'Unknown error'}`);
    } finally {
      setIsDeleteConfirmOpen(false);
      setDeletingMappingId(null);
    }
  };

  const handleFormSave = () => {
    setIsFormOpen(false);
    setEditingMapping(null);
    fetchData();
  };

  const columns = useMemo<ColumnDef<DisplayMapping>[]>(
    () => [
      {
        accessorKey: 'algaEntityName',
        header: 'Alga Tax Region', // Changed header
        cell: ({ row }) => row.original.algaEntityName || row.original.alga_entity_id || 'N/A',
      },
      {
        accessorKey: 'externalEntityName',
        header: 'QuickBooks Tax Code', // Changed header
        cell: ({ row }) => row.original.externalEntityName || row.original.external_entity_id || 'N/A',
      },
      {
        id: 'actions',
        cell: ({ row }) => {
          const mapping = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0" onClick={(e) => e.stopPropagation()} id={`qbo-taxcode-mapping-actions-menu-${mapping.id}`}>
                  <span className="sr-only">Open menu</span>
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem id={`edit-qbo-taxcode-mapping-menu-item-${mapping.id}`} onClick={(e) => { e.stopPropagation(); handleEdit(mapping); }}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem id={`delete-qbo-taxcode-mapping-menu-item-${mapping.id}`} className="text-red-600 focus:text-red-600" onClick={(e) => { e.stopPropagation(); handleDeleteRequest(mapping.id); }}>
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [handleEdit, handleDeleteRequest]
  );

  const table = useReactTable({
    data: mappings,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  });

  if (isLoading) return <div>Loading Tax Code Mappings...</div>;
  if (error) return <div className="text-red-600">{error}</div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button id="add-qbo-taxcode-mapping-button" onClick={() => { setEditingMapping(null); setIsFormOpen(true); }}>
          Add Tax Code Mapping
        </Button>
      </div>
      <div className="rounded-md border">
        <Table id="qbo-taxcode-mappings-table">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No tax code mappings found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {/* Pagination Controls */}
      <div className="flex items-center justify-end space-x-2 py-4">
        <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} id="qbo-taxcode-mappings-prev-page-button">
          Previous
        </Button>
        <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} id="qbo-taxcode-mappings-next-page-button">
          Next
        </Button>
      </div>

      {/* Edit/Create Dialog */}
      {isFormOpen && (
        <QboMappingFormDialog
          isOpen={isFormOpen}
          onClose={() => setIsFormOpen(false)}
          onSave={handleFormSave}
          existingMapping={editingMapping}
          // Removed tenantId prop
          realmId={realmId}
          algaEntityType={algaEntityType}
          externalEntityType={externalEntityType}
          // Map ITaxRegion to the expected format for the form dialog
          algaEntities={algaEntities.map(r => ({ id: r.region_code, name: r.region_name }))}
          externalEntities={qboEntities} // Pass fetched QBO entities
          algaEntityLabel="Alga Tax Region" // Changed label
          externalEntityLabel="QuickBooks Tax Code" // Changed label
          dialogId="qbo-taxcode-mapping-dialog"
        />
      )}

      {/* Delete Confirmation Dialog */}
      {isDeleteConfirmOpen && deletingMappingId && (
         <ConfirmationDialog
           isOpen={isDeleteConfirmOpen}
           onClose={() => setIsDeleteConfirmOpen(false)}
           onConfirm={handleDeleteConfirm}
           title="Delete Tax Code Mapping" // Changed title
           message={`Are you sure you want to delete the mapping for ${mappings.find(m => m.id === deletingMappingId)?.algaEntityName || 'this tax region'}? This action cannot be undone.`} // Changed message
           confirmLabel="Delete"
           cancelLabel="Cancel"
           isConfirming={isLoading}
           id={`confirm-delete-qbo-taxcode-mapping-dialog-${deletingMappingId}`}
         />
      )}
    </div>
  );
}