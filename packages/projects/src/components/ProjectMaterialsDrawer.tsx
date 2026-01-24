'use client';

import React from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';

interface ProjectMaterialsDrawerProps {
  projectId: string;
  clientId?: string | null;
}

export default function ProjectMaterialsDrawer({ projectId }: ProjectMaterialsDrawerProps) {
  return (
    <div className="p-4">
      <Alert>
        <AlertDescription>
          Project materials are now owned by Billing. (projectId: {projectId})
        </AlertDescription>
      </Alert>
    </div>
  );
}

