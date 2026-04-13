'use client';

import React from 'react';
import { Activity, ActivityType } from '@alga-psa/types';
import type { ActivityGroup } from '@alga-psa/workflows/actions';
import { Calendar, Layers, MessageSquare, ListChecks } from 'lucide-react';

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
}

function formatDate(dateString?: string): string {
  if (!dateString) return '';
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getTypeIcon(type: ActivityType) {
  const cls = "ua-print-type-icon";
  switch (type) {
    case ActivityType.TICKET:
      return <MessageSquare className={cls} />;
    case ActivityType.PROJECT_TASK:
      return <Layers className={cls} />;
    case ActivityType.SCHEDULE:
      return <Calendar className={cls} />;
    case ActivityType.WORKFLOW_TASK:
      return <ListChecks className={cls} />;
    default:
      return <span className="ua-print-type">•</span>;
  }
}

function ActivityRow({ activity }: { activity: Activity }) {
  const metaParts: string[] = [];
  if (activity.status) metaParts.push(activity.status);
  if (activity.priorityName) metaParts.push(activity.priorityName);
  if (activity.dueDate) metaParts.push(`due ${formatDate(activity.dueDate)}`);

  return (
    <div className="ua-print-row">
      {getTypeIcon(activity.type)}
      <span className="ua-print-title">{activity.title}</span>
      {metaParts.length > 0 && (
        <span className="ua-print-meta">{metaParts.join(' · ')}</span>
      )}
    </div>
  );
}

/**
 * Renders a print-only version of the activities list.
 * Hidden by default; only appears when `html.ua-print-mode` is set
 * (toggled by the Print button in ActivitiesDataTableSection).
 *
 * In grouped mode, fetches the user's groups and organizes activities by group.
 * In flat mode, just renders the flat list.
 */
export function PrintableActivitiesView({
  activities,
  grouped = false,
  serverGroups = [],
  ungroupedCollapsed = false,
  title = 'Activities',
}: PrintableActivitiesViewProps) {
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

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
    <div className="ua-print-root ua-print-only">
      <div className="ua-print-header">
        {title}
        <span className="ua-print-header-date">{dateStr}</span>
      </div>

      {groupedSections.length > 0 ? (
        <>
          {groupedSections.map((g) => (
            <div key={g.name} className="ua-print-group">
              <div className="ua-print-group-name">{g.name}</div>
              {g.activities.length === 0 ? (
                <div className="ua-print-row" style={{ color: '#888', fontStyle: 'italic' }}>
                  (empty)
                </div>
              ) : (
                g.activities.map((a) => <ActivityRow key={`${a.type}:${a.id}`} activity={a} />)
              )}
            </div>
          ))}
          {ungroupedActivities.length > 0 && !ungroupedCollapsed && (
            <div className="ua-print-group">
              <div className="ua-print-group-name">Ungrouped</div>
              {ungroupedActivities.map((a) => (
                <ActivityRow key={`${a.type}:${a.id}`} activity={a} />
              ))}
            </div>
          )}
        </>
      ) : (
        activities.map((a) => <ActivityRow key={`${a.type}:${a.id}`} activity={a} />)
      )}
    </div>
  );
}
