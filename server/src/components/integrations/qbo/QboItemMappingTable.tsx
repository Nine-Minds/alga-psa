// server/src/components/integrations/qbo/QboItemMappingTable.tsx
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
// Placeholder imports for server actions - these need to be created
import { getQboItems } from '@product/actions/integrations/qboActions'; // TODO: Create this action
// Placeholder import for the Edit/Create Dialog - needs to be created
import { QboMappingFormDialog } from './QboMappingFormDialog';
// Use the existing ConfirmationDialog
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { IService } from 'server/src/interfaces';
import { getServices } from '@product/actions/serviceActions';
// Removed unused import for DeleteConfirmationDialog

// Types matching externalMappingActions.ts and placeholders
interface AlgaService {
  id: string; // or number
  name: string;
}

interface QboItem {
  id: string; // QBO ItemRef.value
  name: string; // Qbo Item Name
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


// Combined type for display, extending the correct base type
export interface DisplayMapping extends ExternalEntityMapping {
  algaEntityName?: string;
  externalEntityName?: string;
}

interface QboItemMappingTableProps {
  realmId: string;
  // Removed tenantId prop
}

export function QboItemMappingTable({ realmId }: QboItemMappingTableProps) {
  const [mappings, setMappings] = useState<DisplayMapping[]>([]);
  const [algaServices, setAlgaServices] = useState<IService[]>([]); // Use IService type
  const [qboItems, setQboItems] = useState<QboItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingMapping, setEditingMapping] = useState<DisplayMapping | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [deletingMappingId, setDeletingMappingId] = useState<string | null>(null);

  const algaEntityType = 'service'; // Specific to this table
  const externalEntityType = 'Item'; // Specific to QBO Items

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Corrected call to getExternalEntityMappings
      // Corrected call to getServices (handles pagination internally, tenant handled internally)
      const [mappingData, servicesResponse, itemsData] = await Promise.all([
        getExternalEntityMappings({ // Pass params object
          integrationType: 'quickbooks_online',
          algaEntityType: algaEntityType,
          externalRealmId: realmId,
        }),
        getServices(), // Use existing action - fetches all services by default
        getQboItems(), // Fetches based on current user context internally
      ]);

      // Use IService type and properties from the paginated response
      const currentServices: IService[] = servicesResponse?.services || [];
      const currentItems: QboItem[] = itemsData || [];
      setAlgaServices(currentServices);
      setQboItems(currentItems);

      // Combine data for display with explicit types
      const displayMappings = (mappingData || []).map((m: ExternalEntityMapping): DisplayMapping => ({
        ...m,
        // Use service_id and service_name from IService
        algaEntityName: currentServices.find((s: IService) => s.service_id === m.alga_entity_id)?.service_name || m.alga_entity_id,
        externalEntityName: currentItems.find((i: QboItem) => i.id === m.external_entity_id)?.name || m.external_entity_id,
      }));
      setMappings(displayMappings);

    } catch (err: any) { // Add type annotation for error
      console.error('Error fetching QBO Item mapping data:', err);
      setError('Failed to load mappings. Please try again.');
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
    setIsLoading(true); // Indicate loading during delete
    setError(null);
    try {
      // Call delete action (tenantId handled internally)
      await deleteExternalEntityMapping(deletingMappingId);
      console.log(`Successfully deleted mapping ${deletingMappingId}`);
      fetchData(); // Refresh data after delete
    } catch (err: any) {
        console.error(`Failed to delete mapping ${deletingMappingId}:`, err);
        setError(`Failed to delete mapping: ${err.message || 'Unknown error'}`);
    } finally {
        setIsDeleteConfirmOpen(false);
        setDeletingMappingId(null);
        // setIsLoading(false); // fetchData will set loading state
    }
  };

  const handleFormSave = () => {
    setIsFormOpen(false);
    setEditingMapping(null);
    fetchData(); // Refresh data after save/update
  };

  const columns = useMemo<ColumnDef<DisplayMapping>[]>(
    () => [
      {
        accessorKey: 'algaEntityName', // Keep accessor for display name
        header: 'Alga Service',
        // Use alga_entity_id as fallback if name is missing
        cell: ({ row }) => row.original.algaEntityName || row.original.alga_entity_id || 'N/A',
      },
      {
        accessorKey: 'externalEntityName', // Keep accessor for display name
        header: 'QuickBooks Item',
        // Use external_entity_id as fallback if name is missing
        cell: ({ row }) => row.original.externalEntityName || row.original.external_entity_id || 'N/A',
      },
      {
        id: 'actions',
        cell: ({ row }) => {
          const mapping = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-8 w-8 p-0"
                  onClick={(e) => e.stopPropagation()}
                  id={`qbo-item-mapping-actions-menu-${mapping.id}`} // Unique ID
                >
                  <span className="sr-only">Open menu</span>
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  id={`edit-qbo-item-mapping-menu-item-${mapping.id}`} // Unique ID
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEdit(mapping);
                  }}
                >
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  id={`delete-qbo-item-mapping-menu-item-${mapping.id}`} // Unique ID
                  className="text-red-600 focus:text-red-600"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteRequest(mapping.id);
                  }}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [handleEdit, handleDeleteRequest] // Dependencies for memoization
  );

  const table = useReactTable({
    data: mappings,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: {
        pageSize: 10, // Default page size
      },
    },
  });

  if (isLoading) {
    return <div>Loading Item Mappings...</div>; // TODO: Use a proper loading spinner component
  }

  if (error) {
    return <div className="text-red-600">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          id="add-qbo-item-mapping-button" // Unique ID
          onClick={() => {
            setEditingMapping(null); // Ensure we are creating new
            setIsFormOpen(true);
          }}
        >
          Add Item Mapping
        </Button>
      </div>
      <div className="rounded-md border">
        <Table id="qbo-item-mappings-table"> {/* Unique ID */}
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && 'selected'}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No item mappings found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {/* Pagination Controls */}
      <div className="flex items-center justify-end space-x-2 py-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
          id="qbo-item-mappings-prev-page-button"
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
          id="qbo-item-mappings-next-page-button"
        >
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
          // Map IService to the expected format for the form dialog
          algaEntities={algaServices.map(s => ({ id: s.service_id, name: s.service_name }))}
          externalEntities={qboItems} // Pass fetched QBO items
          algaEntityLabel="Alga Service"
          externalEntityLabel="QuickBooks Item"
          dialogId="qbo-item-mapping-dialog" // Unique ID
        />
      )}

      {/* Delete Confirmation Dialog using the standard component */}
      {isDeleteConfirmOpen && deletingMappingId && (
         <ConfirmationDialog
           isOpen={isDeleteConfirmOpen}
           onClose={() => setIsDeleteConfirmOpen(false)}
           onConfirm={handleDeleteConfirm}
           title="Delete Item Mapping"
           message={`Are you sure you want to delete the mapping for ${mappings.find(m => m.id === deletingMappingId)?.algaEntityName || 'this item'}? This action cannot be undone.`}
           confirmLabel="Delete"
           cancelLabel="Cancel"
           isConfirming={isLoading} // Use isLoading state to disable button during delete
           id={`confirm-delete-qbo-item-mapping-dialog-${deletingMappingId}`} // Base ID for elements within
         />
      )}
    </div>
  );
}