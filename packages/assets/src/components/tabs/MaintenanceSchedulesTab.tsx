import React, { useState } from 'react';
import useSWR from 'swr';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import { Button } from '@alga-psa/ui/components/Button';
import { CalendarPlus, Pencil, Trash2 } from 'lucide-react';
import { getAssetMaintenanceReport, getAssetMaintenanceSchedules, updateMaintenanceSchedule, deleteMaintenanceSchedule } from '../../actions/assetActions';
import { formatDateOnly } from 'server/src/lib/utils/dateTimeUtils';
import { cn } from 'server/src/lib/utils';
import { CreateMaintenanceScheduleDialog } from './CreateMaintenanceScheduleDialog';
import { Badge } from '@alga-psa/ui/components/Badge';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import type { AssetMaintenanceSchedule } from '@alga-psa/types';

interface MaintenanceSchedulesTabProps {
  assetId: string;
}

export const MaintenanceSchedulesTab: React.FC<MaintenanceSchedulesTabProps> = ({ assetId }) => {
  const [showDialog, setShowDialog] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<AssetMaintenanceSchedule | null>(null);
  const [deletingSchedule, setDeletingSchedule] = useState<AssetMaintenanceSchedule | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const { data: report, isLoading, mutate } = useSWR(
    assetId ? ['asset', assetId, 'maintenance'] : null,
    ([_, id]) => getAssetMaintenanceReport(id)
  );
  const { data: schedules, mutate: mutateSchedules } = useSWR(
    assetId ? ['asset', assetId, 'maintenance-schedules'] : null,
    ([_, id]) => getAssetMaintenanceSchedules(id)
  );

  const handleDelete = async () => {
    if (!deletingSchedule) return;
    
    setIsDeleting(true);
    try {
      await deleteMaintenanceSchedule(deletingSchedule.schedule_id);
      mutate();
      mutateSchedules();
      setDeletingSchedule(null);
    } catch (error) {
      console.error('Error deleting schedule:', error);
      alert('Failed to delete maintenance schedule');
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return <Card className="h-64 animate-pulse bg-gray-50" />;
  }
  
  return (
    <>
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
                    ? formatDateOnly(new Date(report.next_maintenance))
                    : 'None Scheduled'}
                </span>
              </div>
            </Card>
         </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="text-base font-semibold">Maintenance Schedules</CardTitle>
            <Button 
              id="schedule-maintenance-btn" 
              size="xs" 
              className="flex items-center gap-2"
              onClick={() => setShowDialog(true)}
            >
              <CalendarPlus size={16} />
              Schedule Maintenance
            </Button>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Schedule Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Frequency</TableHead>
                    <TableHead>Next Maintenance</TableHead>
                    <TableHead>Last Maintenance</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedules && schedules.length > 0 ? (
                    schedules.map((schedule) => (
                      <TableRow key={schedule.schedule_id}>
                        <TableCell className="font-medium text-gray-900">
                          {schedule.schedule_name}
                        </TableCell>
                        <TableCell className="text-gray-500 capitalize">
                          {schedule.maintenance_type}
                        </TableCell>
                        <TableCell className="text-gray-500">
                          Every {schedule.frequency_interval} {schedule.frequency}
                          {schedule.frequency_interval > 1 ? 's' : ''}
                        </TableCell>
                        <TableCell className="text-gray-900">
                          {schedule.next_maintenance 
                            ? formatDateOnly(new Date(schedule.next_maintenance))
                            : '-'}
                        </TableCell>
                        <TableCell className="text-gray-500">
                          {schedule.last_maintenance 
                            ? formatDateOnly(new Date(schedule.last_maintenance))
                            : '-'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={schedule.is_active ? 'success' : 'secondary'}>
                            {schedule.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Button
                              id={`edit-maintenance-schedule-${schedule.schedule_id}`}
                              variant="ghost"
                              size="xs"
                              onClick={() => setEditingSchedule(schedule)}
                              className="h-8 w-8 p-0"
                            >
                              <Pencil size={16} />
                            </Button>
                            <Button
                              id={`delete-maintenance-schedule-${schedule.schedule_id}`}
                              variant="ghost"
                              size="xs"
                              onClick={() => setDeletingSchedule(schedule)}
                              className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 size={16} />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={7} className="h-24 text-center text-gray-400">
                        No maintenance schedules found. Click "Schedule Maintenance" to create one.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="text-base font-semibold">Maintenance History</CardTitle>
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
                        {formatDateOnly(new Date(record.performed_at))}
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

    <CreateMaintenanceScheduleDialog
      isOpen={showDialog}
      onClose={() => setShowDialog(false)}
      assetId={assetId}
      schedule={undefined}
      onSuccess={() => {
        mutate(); // Refresh the maintenance report
        mutateSchedules(); // Refresh the schedules list
      }}
    />

    <CreateMaintenanceScheduleDialog
      isOpen={!!editingSchedule}
      onClose={() => setEditingSchedule(null)}
      assetId={assetId}
      schedule={editingSchedule || undefined}
      onSuccess={() => {
        mutate(); // Refresh the maintenance report
        mutateSchedules(); // Refresh the schedules list
        setEditingSchedule(null);
      }}
    />

    <ConfirmationDialog
      isOpen={!!deletingSchedule}
      onClose={() => setDeletingSchedule(null)}
      onConfirm={handleDelete}
      title="Delete Maintenance Schedule"
      message={`Are you sure you want to delete "${deletingSchedule?.schedule_name}"? This action cannot be undone.`}
      confirmLabel="Delete"
      cancelLabel="Cancel"
      isConfirming={isDeleting}
      id="delete-maintenance-schedule-dialog"
    />
    </>
  );
};
