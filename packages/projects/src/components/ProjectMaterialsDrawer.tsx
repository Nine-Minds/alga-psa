'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Package, Plus, Loader2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import type { IProjectMaterial } from '@alga-psa/types';
import { listProjectMaterials } from '@alga-psa/billing/actions';

interface ProjectMaterialsDrawerProps {
  projectId: string;
  clientId?: string | null;
}

export default function ProjectMaterialsDrawer({ projectId }: ProjectMaterialsDrawerProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [materials, setMaterials] = useState<IProjectMaterial[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadMaterials = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const data = await listProjectMaterials(projectId);
      setMaterials(data);
    } catch (error) {
      console.error('Error loading materials:', error);
      toast.error('Failed to load materials');
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadMaterials();
  }, [loadMaterials]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Package className="w-5 h-5" />
          Materials
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAddForm(true)}
        >
          <Plus className="w-4 h-4 mr-1" />
          Add
        </Button>
      </div>

      {showAddForm && (
        <div className="text-sm text-gray-500">
          Add form coming soon. (projectId: {projectId})
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-6 text-gray-500">
          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
          Loading materials...
        </div>
      ) : materials.length === 0 ? (
        <div className="text-center py-6 text-gray-500">
          No materials added to this project.
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          {materials.map((material) => (
            <div
              key={material.project_material_id}
              className="flex items-center justify-between border-b pb-2 last:border-0"
            >
              <div>
                <div className="font-medium">{material.service_name || 'Unknown Product'}</div>
                {material.sku && (
                  <div className="text-xs text-gray-500">{material.sku}</div>
                )}
              </div>
              <div className="text-gray-500">Qty: {material.quantity}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
