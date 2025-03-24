'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Box, Card, Heading } from '@radix-ui/themes';
import { Button } from 'server/src/components/ui/Button';
import { MoreVertical, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from 'server/src/components/ui/DropdownMenu';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { IPlanBundle } from 'server/src/interfaces/planBundle.interfaces';
import { getPlanBundles, deletePlanBundle } from 'server/src/lib/actions/planBundleActions';
import { PlanBundleDialog } from './PlanBundleDialog';

const PlanBundles: React.FC = () => {
  const [bundles, setBundles] = useState<IPlanBundle[]>([]);
  const [editingBundle, setEditingBundle] = useState<IPlanBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetchBundles();
  }, []);

  const fetchBundles = async () => {
    try {
      const fetchedBundles = await getPlanBundles();
      setBundles(fetchedBundles);
      setError(null);
    } catch (error) {
      console.error('Error fetching plan bundles:', error);
      setError('Failed to fetch plan bundles');
    }
  };

  const handleDeleteBundle = async (bundleId: string) => {
    try {
      await deletePlanBundle(bundleId);
      fetchBundles();
    } catch (error) {
      if (error instanceof Error) {
        alert(error.message);
      } else {
        alert('Failed to delete bundle');
      }
    }
  };

  const bundleColumns: ColumnDefinition<IPlanBundle>[] = [
    {
      title: 'Bundle Name',
      dataIndex: 'bundle_name',
    },
    {
      title: 'Description',
      dataIndex: 'description',
      render: (value) => value || 'No description',
    },
    {
      title: 'Status',
      dataIndex: 'is_active',
      render: (value) => value ? 'Active' : 'Inactive',
    },
    {
      title: 'Actions',
      dataIndex: 'bundle_id',
      render: (value, record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id="bundle-actions-menu"
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
              id="edit-bundle-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                setEditingBundle({...record});
              }}
            >
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              id="delete-bundle-menu-item"
              className="text-red-600 focus:text-red-600"
              onClick={async (e) => {
                e.stopPropagation();
                if (record.bundle_id) {
                  handleDeleteBundle(record.bundle_id);
                }
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const handleBundleClick = (bundle: IPlanBundle) => {
    if (bundle.bundle_id) {
      router.push(`/msp/billing?tab=plan-bundles&bundleId=${bundle.bundle_id}`);
    }
  };

  return (
    <Card size="2">
      <Box p="4">
        <div className="flex justify-between items-center mb-4">
          <Heading as="h3" size="4">Plan Bundles</Heading>
          <PlanBundleDialog 
            onBundleAdded={fetchBundles} 
            editingBundle={editingBundle}
            onClose={() => setEditingBundle(null)}
            triggerButton={
              <Button id='add-bundle-button'>
                <Plus className="h-4 w-4 mr-2" />
                Add Bundle
              </Button>
            }
          />
        </div>
        
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}
        
        <DataTable
          data={bundles.filter(bundle => bundle.bundle_id !== undefined)}
          columns={bundleColumns}
          pagination={true}
          onRowClick={handleBundleClick}
          rowClassName={() => "cursor-pointer"}
        />
      </Box>
    </Card>
  );
};

export default PlanBundles;