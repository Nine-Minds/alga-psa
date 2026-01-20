'use client';

import { Suspense } from 'react';
import { Card } from 'server/src/components/ui/Card';
import { CustomFieldsManager } from 'server/src/components/settings/custom-fields/CustomFieldsManager';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';

export default function CustomFieldsSettingsPage() {
  return (
    <div className="container mx-auto p-6">
      <Card className="p-6">
        <Suspense fallback={
          <div className="flex justify-center py-8" role="status" aria-label="Loading custom fields settings">
            <LoadingIndicator text="Loading..." />
          </div>
        }>
          <CustomFieldsManager />
        </Suspense>
      </Card>
    </div>
  );
}
