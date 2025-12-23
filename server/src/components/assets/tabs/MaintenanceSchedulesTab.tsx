import React from 'react';
import useSWR from 'swr';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/Table';
import { Button } from '../../ui/Button';
import { CalendarPlus } from 'lucide-react';
import { getAssetMaintenanceReport } from '../../../lib/actions/asset-actions/assetActions';
import { formatDateTime } from '../../../lib/utils/dateTimeUtils';
import { cn } from 'server/src/lib/utils';

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
    <div className="flex flex-col gap-6">
       <div className="flex flex-col sm:flex-row gap-4">
          <Card className="p-6 flex-1">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-gray-400 uppercase font-bold tracking-wider">Compliance Rate</span>
              <span className={cn(
                "text-2xl font-bold",
                report?.compliance_rate && report.compliance_rate >= 90 ? 'text-emerald-600' : 'text-amber-600'
              )}>
                {report?.compliance_rate?.toFixed(1) || 100}%
              </span>
            </div>
          </Card>
          <Card className="p-6 flex-1">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-gray-400 uppercase font-bold tracking-wider">Next Maintenance</span>
              <span className="text-xl font-medium text-gray-900">
                {report?.next_maintenance 
                  ? formatDateTime(new Date(report.next_maintenance), Intl.DateTimeFormat().resolvedOptions().timeZone)
                  : 'None Scheduled'}
              </span>
            </div>
          </Card>
       </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-base font-semibold">Maintenance History</CardTitle>
          <Button id="schedule-maintenance-btn" size="xs" className="flex items-center gap-2">
            <CalendarPlus size={16} />
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
                      <TableCell className="text-gray-900">
                        {formatDateTime(new Date(record.performed_at), Intl.DateTimeFormat().resolvedOptions().timeZone)}
                      </TableCell>
                      <TableCell className="text-gray-900">{record.performed_by}</TableCell>
                      <TableCell className="text-gray-500">{record.notes || '-'}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={3} className="h-24 text-center text-gray-400">
                      No maintenance history recorded.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};