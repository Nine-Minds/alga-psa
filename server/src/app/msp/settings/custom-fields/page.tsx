'use client';

import { Suspense } from 'react';
import { Card } from 'server/src/components/ui/Card';
import { CustomFieldsManager } from 'server/src/components/settings/custom-fields/CustomFieldsManager';

export default function CustomFieldsSettingsPage() {
  return (
    <div className="container mx-auto p-6">
      <Card className="p-6">
        <Suspense fallback={<div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div></div>}>
          <CustomFieldsManager />
        </Suspense>
      </Card>
    </div>
  );
}
