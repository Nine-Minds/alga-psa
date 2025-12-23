import React from 'react';
import useSWR from 'swr';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { getAssetHistory } from '../../../lib/actions/asset-actions/assetActions';
import { formatDateTime } from '../../../lib/utils/dateTimeUtils';

interface AuditLogTabProps {
  assetId: string;
}

export const AuditLogTab: React.FC<AuditLogTabProps> = ({ assetId }) => {
  const { data: history, isLoading } = useSWR(
    assetId ? ['asset', assetId, 'history'] : null,
    ([_, id]) => getAssetHistory(id)
  );

  if (isLoading) {
    return <Card className="h-64 animate-pulse bg-gray-50" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit Log</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6 relative before:absolute before:inset-0 before:left-2 before:h-full before:w-0.5 before:bg-gray-100">
          {history && history.map((record, index) => (
            <div key={index} className="relative pl-8">
              <div className="absolute left-0 top-1 w-4 h-4 rounded-full border-2 border-white bg-gray-400 shadow-sm" />
              <div className="flex flex-col">
                <h4 className="text-sm font-semibold text-gray-900">
                  {record.change_type.charAt(0).toUpperCase() + record.change_type.slice(1)}
                </h4>
                <p className="text-sm text-gray-500">
                  Changed by user {record.changed_by}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {formatDateTime(new Date(record.changed_at), Intl.DateTimeFormat().resolvedOptions().timeZone)}
                </p>
              </div>
            </div>
          ))}
          {(!history || history.length === 0) && (
            <p className="text-sm text-gray-400 text-center py-4">No audit history available.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
