import React from 'react';
import useSWR from 'swr';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/Table';
import { Button, Group, Text, Stack } from '@mantine/core';
import { CalendarPlus } from 'lucide-react';
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
          <Card className="p-6">
            <Stack gap="xs">
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Compliance Rate</Text>
              <Text size="xl" fw={700} c={report?.compliance_rate && report.compliance_rate >= 90 ? 'green' : 'orange'}>
                {report?.compliance_rate?.toFixed(1) || 100}%
              </Text>
            </Stack>
          </Card>
          <Card className="p-6">
            <Stack gap="xs">
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Next Maintenance</Text>
              <Text size="lg" fw={500}>
                {report?.next_maintenance 
                  ? formatDateTime(new Date(report.next_maintenance), Intl.DateTimeFormat().resolvedOptions().timeZone)
                  : 'None Scheduled'}
              </Text>
            </Stack>
          </Card>
       </Group>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-base font-semibold">Maintenance History</CardTitle>
          <Button id="schedule-maintenance-btn" leftSection={<CalendarPlus size={16} />} size="xs">
            Schedule Maintenance
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Performed At</TableHead>
                  <TableHead>Performed By</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report?.maintenance_history && report.maintenance_history.length > 0 ? (
                  report.maintenance_history.map((record) => (
                    <TableRow key={record.history_id}>
                      <TableCell>
                        {formatDateTime(new Date(record.performed_at), Intl.DateTimeFormat().resolvedOptions().timeZone)}
                      </TableCell>
                      <TableCell>{record.performed_by}</TableCell>
                      <TableCell className="text-muted-foreground">{record.notes || '-'}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={3} className="h-24 text-center">
                      No maintenance history recorded.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </Stack>
  );
};