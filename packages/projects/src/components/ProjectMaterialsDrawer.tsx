'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Package, Plus, Loader2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import type { IProjectMaterial } from '@alga-psa/types';
import { listProjectMaterials } from '@alga-psa/billing/actions';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';

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

  const calculateTotal = (material: IProjectMaterial) => material.quantity * material.rate;

  const unbilledByCurrency = materials
    .filter((material) => !material.is_billed)
    .reduce((acc, material) => {
      const currency = material.currency_code || 'USD';
      if (!acc[currency]) acc[currency] = 0;
      acc[currency] += calculateTotal(material);
      return acc;
    }, {} as Record<string, number>);

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
        <div className="space-y-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 font-medium">Product</th>
                  <th className="pb-2 font-medium text-right">Qty</th>
                  <th className="pb-2 font-medium text-right">Rate</th>
                  <th className="pb-2 font-medium text-right">Total</th>
                  <th className="pb-2 font-medium text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {materials.map((material) => (
                  <tr key={material.project_material_id} className="border-b last:border-0">
                    <td className="py-2">
                      <div>
                        <span className="font-medium">{material.service_name || 'Unknown Product'}</span>
                        {material.sku && (
                          <span className="text-gray-500 ml-1">({material.sku})</span>
                        )}
                      </div>
                      {material.description && (
                        <div className="text-xs text-gray-500">{material.description}</div>
                      )}
                    </td>
                    <td className="py-2 text-right">{material.quantity}</td>
                    <td className="py-2 text-right">
                      {formatCurrencyFromMinorUnits(material.rate, 'en-US', material.currency_code)}
                    </td>
                    <td className="py-2 text-right font-medium">
                      {formatCurrencyFromMinorUnits(calculateTotal(material), 'en-US', material.currency_code)}
                    </td>
                    <td className="py-2 text-center">
                      {material.is_billed ? (
                        <Badge variant="default">Billed</Badge>
                      ) : (
                        <Badge variant="outline">Pending</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {Object.keys(unbilledByCurrency).length > 0 && (
            <div className="flex justify-end pt-2 border-t">
              <div className="text-sm space-y-1">
                {Object.entries(unbilledByCurrency).map(([currency, total]) => (
                  <div key={currency} className="text-right">
                    <span className="text-gray-500">Unbilled ({currency}): </span>
                    <span className="font-semibold">
                      {formatCurrencyFromMinorUnits(total, 'en-US', currency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
