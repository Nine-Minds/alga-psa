'use client';

import React from 'react';
import { Activity, ActivityType } from '@alga-psa/types';
import type { ActivityGroup } from '@alga-psa/workflows/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { PrintableTable, type PrintableTableColumn } from '@alga-psa/ui/components/PrintableTable';

interface PrintableActivitiesViewProps {
  activities: Activity[];
  /** When true, render activities organized by group using serverGroups */
  grouped?: boolean;
  /** User's activity groups (required when grouped=true, shared with GroupedActivitiesView) */
  serverGroups?: ActivityGroup[];
  /** Whether the ungrouped section is collapsed (hidden from print) */
  ungroupedCollapsed?: boolean;
  /** Fallback title */
  title?: string;
  columns?: PrintableTableColumn<Activity>[];
}

function formatDate(dateString?: string): string {
  if (!dateString) return '';
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

type TFn = (key: string, options?: Record<string, unknown>) => string;

function getTypeLabel(type: ActivityType, t: TFn) {
  switch (type) {
    case ActivityType.TICKET:
      return t('table.activityTypes.ticket', { defaultValue: 'Ticket' });
    case ActivityType.PROJECT_TASK:
      return t('table.activityTypes.projectTask', { defaultValue: 'Project Task' });
    case ActivityType.SCHEDULE:
      return t('table.activityTypes.schedule', { defaultValue: 'Schedule' });
    case ActivityType.WORKFLOW_TASK:
      return t('table.activityTypes.workflowTask', { defaultValue: 'Workflow Task' });
    case ActivityType.TIME_ENTRY:
      return t('table.activityTypes.timeEntry', { defaultValue: 'Time Entry' });
    case ActivityType.NOTIFICATION:
      return t('table.activityTypes.notification', { defaultValue: 'Notification' });
    default:
      return t('table.activityTypes.unknown', { defaultValue: 'Unknown' });
  }
}

/**
 * Renders a print-only version of the activities list.
 * Hidden by default; only appears when `html.app-print-mode` is set
 * by the shared PrintButton.
 *
 * In grouped mode, organizes activities by the user's groups.
 * In flat mode, renders one print-friendly table.
 */
export function PrintableActivitiesView({
  activities,
  grouped = false,
  serverGroups = [],
  ungroupedCollapsed = false,
  title,
  columns: providedColumns,
}: PrintableActivitiesViewProps) {
  const { t } = useTranslation('msp/user-activities');
  const effectiveTitle = title ?? t('printable.defaultTitle', { defaultValue: 'Activities' });
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const defaultColumns: PrintableTableColumn<Activity>[] = [
    {
      key: 'type',
      header: t('table.columns.type', { defaultValue: 'Type' }),
      render: (activity) => getTypeLabel(activity.type, t),
      className: 'ua-print-type-column',
    },
    {
      key: 'title',
      header: t('table.columns.title', { defaultValue: 'Title' }),
      render: (activity) => activity.title,
      className: 'ua-print-title-column',
    },
    {
      key: 'status',
      header: t('table.columns.status', { defaultValue: 'Status' }),
      render: (activity) => activity.status || t('table.values.emDash', { defaultValue: '—' }),
    },
    {
      key: 'priority',
      header: t('table.columns.priority', { defaultValue: 'Priority' }),
      render: (activity) => activity.priorityName || activity.priority || t('table.values.emDash', { defaultValue: '—' }),
    },
    {
      key: 'dueDate',
      header: t('table.columns.dueDate', { defaultValue: 'Due Date' }),
      render: (activity) => formatDate(activity.dueDate) || t('table.values.noDueDate', { defaultValue: 'No due date' }),
      className: 'ua-print-date-column',
    },
  ];
  const columns = providedColumns ?? defaultColumns;

  const renderTable = (sectionTitle: string, rows: Activity[]) => (
    <PrintableTable
      title={sectionTitle}
      subtitle={dateStr}
      rows={rows}
      columns={columns}
      getRowKey={(activity) => `${activity.type}:${activity.id}`}
      emptyMessage={t('printable.empty', { defaultValue: '(empty)' })}
    />
  );

  // Build grouped structure if needed
  let groupedSections: Array<{ name: string; activities: Activity[] }> = [];
  let ungroupedActivities: Activity[] = activities;

  if (grouped && serverGroups.length > 0) {
    const activityByKey = new Map<string, Activity>();
    for (const a of activities) {
      activityByKey.set(`${a.type}:${a.id}`, a);
    }
    const assignedKeys = new Set<string>();
    groupedSections = serverGroups
      .filter((sg) => !sg.isCollapsed)
      .map((sg) => {
        const sgActs: Activity[] = [];
        for (const item of sg.items) {
          const key = `${item.activityType}:${item.activityId}`;
          const act = activityByKey.get(key);
          if (act) {
            sgActs.push(act);
            assignedKeys.add(key);
          }
        }
        return { name: sg.groupName, activities: sgActs };
      });
    // Items in collapsed groups should also be excluded from ungrouped
    for (const sg of serverGroups.filter((sg) => sg.isCollapsed)) {
      for (const item of sg.items) {
        assignedKeys.add(`${item.activityType}:${item.activityId}`);
      }
    }
    ungroupedActivities = activities.filter((a) => !assignedKeys.has(`${a.type}:${a.id}`));
  }

  return (
    <div className="app-print-root app-print-only ua-print-root ua-print-only">
      {groupedSections.length > 0 ? (
        <>
          {groupedSections.map((g) => (
            <div key={g.name} className="ua-print-group">
              {renderTable(g.name, g.activities)}
            </div>
          ))}
          {ungroupedActivities.length > 0 && !ungroupedCollapsed && (
            <div className="ua-print-group">
              {renderTable(t('printable.ungroupedHeading', { defaultValue: 'Ungrouped' }), ungroupedActivities)}
            </div>
          )}
        </>
      ) : (
        renderTable(effectiveTitle, activities)
      )}
    </div>
  );
}
