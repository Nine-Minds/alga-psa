'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

type RunStudioShellProps = {
  runId: string;
};

const RunStudioShell: React.FC<RunStudioShellProps> = ({ runId }) => {
  const { t } = useTranslation('msp/licensing');
  return (
    <div className="p-6 text-sm text-gray-500">
      {t('runStudio.unavailable', {
        defaultValue: 'Workflow Run Studio is not available in this edition. (runId: {{runId}})',
        runId,
      })}
    </div>
  );
};

export default RunStudioShell;
