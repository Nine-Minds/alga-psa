'use client'
import React, { useMemo } from 'react';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { WorkItemWithStatus, WorkItemType } from '@alga-psa/types';

interface MetaLinesProps {
  clientName?: string | null;
  assignedToName?: string;
  dueDate?: Date | string;
  assignedUserIds?: string[];
  additionalUserIds?: string[];
  workItemType?: WorkItemType;
}

const MetaLines: React.FC<MetaLinesProps> = ({
  clientName,
  assignedToName,
  dueDate,
  assignedUserIds,
  additionalUserIds,
  workItemType
}) => {
  const { t } = useTranslation('msp/time-entry');
  const { formatDate } = useFormatters();

  const assignedDisplay = useMemo(() => {
    // For interactions, just show the assigned user name as before
    if (workItemType === 'interaction') {
      return assignedToName
        ? assignedToName
        : (assignedToName === undefined ? null : t('common.fallbacks.unassigned', { defaultValue: 'Unassigned' }));
    }

    // For tickets and project tasks, calculate total unique assigned users
    const allUserIds = [
      ...(assignedUserIds || []),
      ...(additionalUserIds || [])
    ].filter(id => id);

    // Use Set to get unique user count
    const uniqueUserIds = new Set(allUserIds);
    const totalUsers = uniqueUserIds.size;

    // No assigned name and no users
    if (!assignedToName && totalUsers === 0) {
      return assignedToName === undefined
        ? null
        : t('common.fallbacks.unassigned', { defaultValue: 'Unassigned' });
    }

    // No assigned name but have users
    if (!assignedToName && totalUsers > 0) {
      return totalUsers === 1
        ? t('workItemList.assignment.oneUser', { defaultValue: '1 user assigned' })
        : t('workItemList.assignment.multipleUsers', {
            defaultValue: '{{count}} users assigned',
            count: totalUsers
          });
    }

    // Have assigned name
    if (assignedToName) {
      if (totalUsers <= 1) {
        return assignedToName;
      }
      // Show primary user plus count of additional users
      const additionalUsersCount = totalUsers - 1;
      return additionalUsersCount === 1
        ? t('workItemList.assignment.additionalUsers', {
            defaultValue: '{{name}}, +{{count}} user',
            name: assignedToName,
            count: additionalUsersCount
          })
        : t('workItemList.assignment.additionalUsersOther', {
            defaultValue: '{{name}}, +{{count}} users',
            name: assignedToName,
            count: additionalUsersCount
          });
    }

    return null;
  }, [assignedToName, assignedUserIds, additionalUserIds, t, workItemType]);

  return (
    <>
      {clientName && (
        <div className="text-sm text-[rgb(var(--color-text-600))] mt-1">
          {clientName}
        </div>
      )}
      {assignedDisplay !== null && (
        <div className="text-sm text-[rgb(var(--color-text-600))] mt-1">
          {t('workItemList.meta.assignedTo', {
            defaultValue: 'Assigned to: {{value}}',
            value: assignedDisplay
          })}
        </div>
      )}
      {dueDate !== undefined && (
        <div className="text-sm text-[rgb(var(--color-text-600))] mt-1">
          {t('workItemList.meta.dueDate', {
            defaultValue: 'Due Date: {{value}}',
            value: dueDate
              ? formatDate(new Date(dueDate), { dateStyle: 'medium' })
              : t('common.fallbacks.noDueDate', { defaultValue: 'No due date' })
          })}
        </div>
      )}
    </>
  );
};

interface WorkItemListProps {
  items: WorkItemWithStatus[];
  isSearching: boolean;
  currentPage: number;
  totalPages: number;
  total: number;
  hasMore: boolean;
  onPageChange: (newPage: number) => void;
  onSelect: (workItem: WorkItemWithStatus) => void;
}

export function WorkItemList({
  items,
  isSearching,
  currentPage,
  totalPages,
  total,
  hasMore,
  onPageChange,
  onSelect
}: WorkItemListProps) {
  const { t } = useTranslation('msp/time-entry');
  const { formatDate } = useFormatters();

  const renderItemContent = (item: WorkItemWithStatus) => {
    if (item.type === 'ticket') {
      const isBundledTicket = !!item.master_ticket_id;
      return (
        <>
          <div className="font-medium text-[rgb(var(--color-text-900))] text-lg mb-1">
            {item.ticket_number} - {item.title || t('common.fallbacks.untitled', { defaultValue: 'Untitled' })}
          </div>
          <MetaLines
            clientName={item.client_name}
            assignedToName={item.assigned_to_name}
            dueDate={item.due_date}
            assignedUserIds={item.assigned_user_ids}
            additionalUserIds={item.additional_user_ids}
            workItemType={item.type}
          />
          <div className="flex items-center gap-2 mt-1">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[rgb(var(--color-primary-200))] text-[rgb(var(--color-primary-900))]">
              {t('common.types.ticket', { defaultValue: 'Ticket' })}
            </span>
            {item.is_billable && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[rgb(var(--color-accent-100))] text-[rgb(var(--color-accent-800))]">
                {t('common.types.billable', { defaultValue: 'Billable' })}
              </span>
            )}
          </div>
          {isBundledTicket && (
            <div className="text-sm text-[rgb(var(--color-text-600))] mt-2 italic">
              {t('workItemList.bundledTicket', {
                defaultValue: 'Bundled ticket — log time on the master ticket{{suffix}}.',
                suffix: item.master_ticket_number ? ` #${item.master_ticket_number}` : ''
              })}
            </div>
          )}
        </>
      );
    } else if (item.type === 'project_task') {
      return (
        <>
          <div className="font-medium text-[rgb(var(--color-text-900))] text-lg mb-1">
            {item.task_name}
          </div>
          <div className="text-sm text-[rgb(var(--color-text-600))]">
            {item.project_name} • {item.phase_name}
          </div>
          <MetaLines
            clientName={item.client_name}
            assignedToName={item.assigned_to_name}
            dueDate={item.due_date}
            assignedUserIds={item.assigned_user_ids}
            additionalUserIds={item.additional_user_ids}
            workItemType={item.type}
          />
          <div className="flex items-center gap-2 mt-1">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[rgb(var(--color-secondary-100))] text-[rgb(var(--color-secondary-900))]">
              {t('common.types.projectTask', { defaultValue: 'Project Task' })}
            </span>
            {item.is_billable && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[rgb(var(--color-accent-100))] text-[rgb(var(--color-accent-800))]">
                {t('common.types.billable', { defaultValue: 'Billable' })}
              </span>
            )}
          </div>
        </>
      );
    } else if (item.type === 'ad_hoc') {
      return (
        <>
          <div className="font-medium text-[rgb(var(--color-text-900))] text-lg mb-1">
            {item.title || item.name}
          </div>
          {item.scheduled_start && item.scheduled_end && (
            <div className="text-sm text-[rgb(var(--color-text-600))]">
              {t('workItemList.meta.scheduledEnd', {
                defaultValue: 'Scheduled end: {{value}}',
                value: formatDate(new Date(item.scheduled_end), {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit'
                })
              })}
            </div>
          )}
          <MetaLines
            assignedToName={item.assigned_to_name}
            workItemType={item.type}
          />
          <div className="flex items-center gap-2 mt-1">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[rgb(var(--color-border-200))] text-[rgb(var(--color-border-900))]">
              {t('common.types.adHocEntry', { defaultValue: 'Ad-hoc Entry' })}
            </span>
            {item.is_billable && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[rgb(var(--color-accent-100))] text-[rgb(var(--color-accent-800))]">
                {t('common.types.billable', { defaultValue: 'Billable' })}
              </span>
            )}
          </div>
        </>
      );
    } else if (item.type === 'interaction') {
      return (
        <>
          <div className="font-medium text-[rgb(var(--color-text-900))] text-lg mb-1">
            {item.title || item.name}
          </div>
          <div className="text-sm text-[rgb(var(--color-text-600))]">
            {item.interaction_type
              ? t('workItemList.interactionType', {
                  defaultValue: '{{type}} • {{client}}',
                  type: item.interaction_type,
                  client: item.client_name
                })
              : item.client_name}
          </div>
          {item.contact_name && (
            <div className="text-sm text-[rgb(var(--color-text-600))] mt-1">
              {t('workItemList.meta.contact', {
                defaultValue: 'Contact: {{value}}',
                value: item.contact_name
              })}
            </div>
          )}
          <MetaLines
            assignedToName={item.assigned_to_name}
            workItemType={item.type}
          />
          <div className="flex items-center gap-2 mt-1">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-900 dark:text-green-300">
              {t('common.types.interaction', { defaultValue: 'Interaction' })}
            </span>
            {item.is_billable && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[rgb(var(--color-accent-100))] text-[rgb(var(--color-accent-800))]">
                {t('common.types.billable', { defaultValue: 'Billable' })}
              </span>
            )}
          </div>
        </>
      );
    }
    return null;
  };

  return (
    <div className="flex-1 min-h-[200px] overflow-auto transition-all duration-300">
      <div className="h-full overflow-y-auto">
        <div className="bg-white rounded-md border border-[rgb(var(--color-border-200))]">
          {items.length > 0 ? (
            <div>
              <ul className="divide-y divide-[rgb(var(--color-border-200))]">
                {items.map((item) => {
                  const isDisabled = item.type === 'ticket' && !!item.master_ticket_id;
                  return (
                    <li
                      key={item.work_item_id}
                      aria-disabled={isDisabled}
                      className={[
                        'bg-[rgb(var(--color-border-50))] transition-colors duration-150',
                        isDisabled
                          ? 'opacity-50 cursor-not-allowed'
                          : 'hover:bg-[rgb(var(--color-border-100))] cursor-pointer',
                      ].join(' ')}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isDisabled) return;
                        onSelect(item);
                      }}
                    >
                      <div className="px-4 py-3">
                        {renderItemContent(item)}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="px-6 py-4 border-t border-gray-100 bg-white">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => onPageChange(currentPage - 1)}
                    disabled={currentPage === 1 || isSearching}
                    className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-[rgb(var(--color-text-700))] bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    id="previous-page-btn"
                  >
                    {t('workItemList.pagination.previous', { defaultValue: 'Previous' })}
                  </button>
                  <span className="text-sm text-[rgb(var(--color-text-700))]">
                    {t('workItemList.pagination.pageInfo', {
                      defaultValue: 'Page {{current}} of {{total}} ({{records}} total records)',
                      current: currentPage,
                      total: Math.max(1, totalPages),
                      records: total
                    })}
                  </span>
                  <button
                    onClick={() => onPageChange(currentPage + 1)}
                    disabled={!hasMore || isSearching || currentPage >= totalPages}
                    className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-[rgb(var(--color-text-700))] bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    id="next-page-btn"
                  >
                    {t('workItemList.pagination.next', { defaultValue: 'Next' })}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 text-center text-[rgb(var(--color-text-500))]">
              {isSearching
                ? t('workItemPicker.empty.searching', { defaultValue: 'Searching...' })
                : t('workItemPicker.empty.noWorkItems', { defaultValue: 'No work items found' })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
