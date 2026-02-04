'use client';

import React, { useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Package, Plus } from 'lucide-react';

interface ProjectMaterialsDrawerProps {
  projectId: string;
  clientId?: string | null;
}

export default function ProjectMaterialsDrawer({ projectId }: ProjectMaterialsDrawerProps) {
  const [showAddForm, setShowAddForm] = useState(false);

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
    </div>
  );
}
