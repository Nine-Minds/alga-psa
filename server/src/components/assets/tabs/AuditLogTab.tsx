import React from 'react';
import useSWR from 'swr';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Text, Timeline } from '@mantine/core';
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
        <Timeline active={-1} bulletSize={12} lineWidth={2}>
          {history && history.map((record, index) => (
            <Timeline.Item 
              key={index} 
              title={record.change_type.charAt(0).toUpperCase() + record.change_type.slice(1)}
              bullet={<div className="w-2 h-2 rounded-full bg-gray-400" />}
            >
              <Text c="dimmed" size="sm">
                Changed by user {record.changed_by}
              </Text>
              <Text size="xs" mt={4}>
                {formatDateTime(new Date(record.changed_at), Intl.DateTimeFormat().resolvedOptions().timeZone)}
              </Text>
              {/* We could expand 'changes' JSON here if needed */}
            </Timeline.Item>
          ))}
          {(!history || history.length === 0) && (
            <Text c="dimmed" ta="center">No audit history available.</Text>
          )}
        </Timeline>
      </CardContent>
    </Card>
  );
};
