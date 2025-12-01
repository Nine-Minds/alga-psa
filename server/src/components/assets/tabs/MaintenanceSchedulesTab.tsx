import React from 'react';
import useSWR from 'swr';
import { Card } from '../../ui/Card';
import { Badge, Button, Group, Text, Stack } from '@mantine/core';
import { CalendarPlus, Check } from 'lucide-react';
import { getAssetMaintenanceReport } from '../../../lib/actions/asset-actions/assetActions';
import { formatDateTime } from '../../../lib/utils/dateTimeUtils';

interface MaintenanceSchedulesTabProps {
  assetId: string;
}

export const MaintenanceSchedulesTab: React.FC<MaintenanceSchedulesTabProps> = ({ assetId }) => {
  const { data: report, isLoading } = useSWR(
    assetId ? ['asset', assetId, 'maintenance'] : null,
    ([_, id]) => getAssetMaintenanceReport(id)
  );

  if (isLoading) {
    return <Card className="h-64 animate-pulse bg-gray-50" />;
  }
  
  return (
    <Stack gap="md">
       <Group grow>
          <Card>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Compliance Rate</Text>
            <Text size="xl" fw={700} c={report?.compliance_rate && report.compliance_rate >= 90 ? 'green' : 'orange'}>
              {report?.compliance_rate?.toFixed(1) || 100}%
            </Text>
          </Card>
          <Card>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Next Maintenance</Text>
            <Text size="lg" fw={500}>
              {report?.next_maintenance 
                ? formatDateTime(new Date(report.next_maintenance), Intl.DateTimeFormat().resolvedOptions().timeZone)
                : 'None Scheduled'}
            </Text>
          </Card>
       </Group>

      <Card 
        title="Maintenance History"
        action={
          <Button leftSection={<CalendarPlus size={16} />} size="xs">
            Schedule Maintenance
          </Button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 dark:bg-gray-800 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Performed At</th>
                <th className="px-4 py-3">Performed By</th>
                <th className="px-4 py-3">Notes</th>
              </tr>
            </thead>
            <tbody>
              {report?.maintenance_history && report.maintenance_history.length > 0 ? (
                report.maintenance_history.map((record) => (
                  <tr key={record.history_id} className="border-b dark:border-gray-700">
                    <td className="px-4 py-3">
                      {formatDateTime(new Date(record.performed_at), Intl.DateTimeFormat().resolvedOptions().timeZone)}
                    </td>
                    <td className="px-4 py-3">{record.performed_by}</td>
                    <td className="px-4 py-3 text-gray-600">{record.notes || '-'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-gray-500">
                    No maintenance history recorded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </Stack>
  );
};