'use client'

import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { CalendarDays, Layers, Layers2, Plus, Settings2, Share2, XCircle } from 'lucide-react';
import type { CalendarAccessLevel, IVisibleCalendar } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useAccessLevelLabel } from './sharing/CalendarShareListEditor';

interface TechnicianSidebarProps {
  /** The viewer's own calendar. */
  me: IVisibleCalendar | null;
  /** Other people's calendars the viewer can see (everyone for user_schedule:update holders). */
  people: IVisibleCalendar[];
  /** Group calendars the viewer is a member of. */
  groups: IVisibleCalendar[];
  /** Whether the viewer sees every calendar (hides per-person access badges). */
  canViewAll: boolean;
  inactiveUserIds?: ReadonlySet<string>;
  focusedTechnicianId: string | null;
  comparisonTechnicianIds: string[];
  selectedGroupCalendarIds: string[];
  onSetFocus: (technicianId: string) => void;
  onComparisonChange: (technicianId: string, add: boolean) => void;
  onGroupCalendarToggle: (calendarId: string, add: boolean) => void;
  onResetSelections?: () => void;
  onSelectAll?: () => void;
  onShareMyCalendar?: () => void;
  onNewGroupCalendar?: () => void;
  onManageGroupCalendar?: (calendar: IVisibleCalendar) => void;
}

const canFocus = (level: CalendarAccessLevel) => level === 'edit' || level === 'manage';

const Swatch: React.FC<{ color: string }> = ({ color }) => (
  <span className="h-3 w-3 flex-shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
);

/**
 * Schedule sidebar: "My calendar", "People" and "Group calendars". Focus picks
 * whose calendar new entries default to; overlays add other calendars.
 */
const TechnicianSidebar: React.FC<TechnicianSidebarProps> = ({
  me,
  people,
  groups,
  canViewAll,
  inactiveUserIds,
  focusedTechnicianId,
  comparisonTechnicianIds,
  selectedGroupCalendarIds,
  onSetFocus,
  onComparisonChange,
  onGroupCalendarToggle,
  onResetSelections,
  onSelectAll,
  onShareMyCalendar,
  onNewGroupCalendar,
  onManageGroupCalendar,
}) => {
  const { t } = useTranslation('msp/schedule');
  const levelLabel = useAccessLevelLabel();

  const sectionHeading = (label: string) => (
    <div className="px-2 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-[rgb(var(--color-text-500))]">
      {label}
    </div>
  );

  const renderPerson = (calendar: IVisibleCalendar, isSelf: boolean) => {
    const userId = calendar.key;
    const isFocus = userId === focusedTechnicianId;
    const isComparing = comparisonTechnicianIds.includes(userId);
    const isInactive = inactiveUserIds?.has(userId) ?? false;
    const focusable = isSelf || canFocus(calendar.access_level);

    return (
      <div
        key={userId}
        className={`min-h-12 mb-1 flex items-center justify-between gap-2 pl-2 rounded-md ${
          isFocus
            ? 'bg-[rgb(var(--color-primary-200))]'
            : isComparing
              ? 'bg-[rgb(var(--color-primary-50))]'
              : ''
        } ${
          isInactive
            ? 'text-[rgb(var(--color-text-400))]'
            : 'text-[rgb(var(--color-text-700))]'
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Swatch color={calendar.color} />
          <div className="min-w-0">
            <div className="truncate">
              {calendar.name}
              {isInactive && (
                <span className="ml-1 text-xs">
                  {t('sidebar.labels.inactive', { defaultValue: '(Inactive)' })}
                </span>
              )}
            </div>
            {!isSelf && !canViewAll && (
              <div className="text-xs text-[rgb(var(--color-text-500))]">{levelLabel(calendar.access_level)}</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {!isFocus && focusable && (
            <Button
              id={`view-week-${userId}`}
              variant="ghost"
              size="sm"
              onClick={() => onSetFocus(userId)}
              tooltipText={t('sidebar.actions.viewWeek', { defaultValue: 'View Week' })}
              tooltip={true}
              aria-label={t('sidebar.aria.viewWeek', {
                defaultValue: 'View week for {{name}}',
                name: calendar.name,
              })}
            >
              <CalendarDays className="h-4 w-4" />
            </Button>
          )}
          {!isFocus && (
            <Button
              id={`compare-tech-${userId}`}
              variant={isComparing ? "default" : "ghost"}
              size="sm"
              onClick={() => onComparisonChange(userId, !isComparing)}
              tooltipText={
                isComparing
                  ? t('sidebar.actions.stopComparing', { defaultValue: 'Stop Comparing' })
                  : t('sidebar.actions.compare', { defaultValue: 'Compare' })
              }
              tooltip={true}
              aria-label={t('sidebar.aria.compare', {
                defaultValue: 'Compare {{name}}',
                name: calendar.name,
              })}
            >
              <Layers2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="w-64 flex-shrink-0 bg-white border border-gray-200 rounded-lg overflow-y-auto">
      <div className="p-2 border-gray-200 space-y-1">
        <div className="flex justify-center gap-1">
          <Button
            id="select-all-button"
            variant="outline"
            size="sm"
            onClick={onSelectAll}
            className="text-xs px-2 py-1 h-7"
            disabled={people.length === 0}
          >
            <Layers className="h-4 w-4 mr-1" />
            {t('sidebar.actions.compareAll', { defaultValue: 'Compare All' })}
          </Button>
          <Button
            id="reset-selections-button"
            variant="outline"
            size="sm"
            onClick={onResetSelections}
            className="text-xs px-2 py-1 h-7"
            disabled={
              !focusedTechnicianId &&
              comparisonTechnicianIds.length === 0 &&
              selectedGroupCalendarIds.length === 0
            }
          >
            <XCircle className="h-4 w-4 mr-1" />
            {t('sidebar.actions.clearAll', { defaultValue: 'Clear All' })}
          </Button>
        </div>
        {onShareMyCalendar && (
          <Button
            id="share-my-calendar-button"
            variant="ghost"
            size="sm"
            onClick={onShareMyCalendar}
            className="w-full justify-start text-xs h-7"
          >
            <Share2 className="h-4 w-4 mr-1" />
            {t('sidebar.actions.shareMyCalendar', { defaultValue: 'Share my calendar' })}
          </Button>
        )}
      </div>

      {sectionHeading(t('sidebar.sections.myCalendar', { defaultValue: 'My calendar' }))}
      <div className="px-1">{me && renderPerson(me, true)}</div>

      {sectionHeading(t('sidebar.sections.people', { defaultValue: 'People' }))}
      <div className="px-1">
        {people.length === 0 ? (
          <p className="px-2 pb-2 text-xs text-[rgb(var(--color-text-500))]">
            {t('sidebar.empty.people', {
              defaultValue: 'No one has shared a calendar with you yet. Share yours so teammates can see when you are free.',
            })}
          </p>
        ) : (
          people.map((calendar) => renderPerson(calendar, false))
        )}
      </div>

      <div className="flex items-center justify-between pr-1">
        {sectionHeading(t('sidebar.sections.groupCalendars', { defaultValue: 'Group calendars' }))}
        {onNewGroupCalendar && (
          <Button
            id="new-group-calendar-button"
            variant="ghost"
            size="sm"
            onClick={onNewGroupCalendar}
            tooltipText={t('sidebar.actions.newGroupCalendar', { defaultValue: 'New group calendar' })}
            tooltip={true}
            aria-label={t('sidebar.actions.newGroupCalendar', { defaultValue: 'New group calendar' })}
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>
      <div className="px-1 pb-2">
        {groups.length === 0 ? (
          <div className="px-2 text-xs text-[rgb(var(--color-text-500))] space-y-2">
            <p>
              {t('sidebar.empty.groups', {
                defaultValue: 'Group calendars hold shared events such as on-call rotations or office closures.',
              })}
            </p>
            {onNewGroupCalendar && (
              <Button id="new-group-calendar-empty-button" variant="outline" size="sm" onClick={onNewGroupCalendar}>
                {t('sidebar.actions.newGroupCalendar', { defaultValue: 'New group calendar' })}
              </Button>
            )}
          </div>
        ) : (
          groups.map((calendar) => {
            const calendarId = calendar.key;
            const isSelected = selectedGroupCalendarIds.includes(calendarId);
            return (
              <div
                key={calendarId}
                className={`min-h-10 mb-1 flex items-center justify-between gap-2 pl-2 rounded-md ${
                  isSelected ? 'bg-[rgb(var(--color-primary-50))]' : ''
                } ${calendar.is_archived ? 'text-[rgb(var(--color-text-400))]' : 'text-[rgb(var(--color-text-700))]'}`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Checkbox
                    id={`group-calendar-toggle-${calendarId}`}
                    checked={isSelected}
                    onChange={(e) => onGroupCalendarToggle(calendarId, e.target.checked)}
                    aria-label={t('sidebar.aria.toggleGroupCalendar', {
                      defaultValue: 'Show {{name}}',
                      name: calendar.name,
                    })}
                  />
                  <Swatch color={calendar.color} />
                  <span className="truncate">
                    {calendar.name}
                    {calendar.is_archived && (
                      <span className="ml-1 text-xs">
                        {t('sidebar.labels.archived', { defaultValue: '(Archived)' })}
                      </span>
                    )}
                  </span>
                </div>
                {calendar.access_level === 'manage' && onManageGroupCalendar && (
                  <Button
                    id={`manage-group-calendar-${calendarId}`}
                    variant="ghost"
                    size="sm"
                    onClick={() => onManageGroupCalendar(calendar)}
                    tooltipText={t('sidebar.actions.manageGroupCalendar', { defaultValue: 'Manage calendar' })}
                    tooltip={true}
                    aria-label={t('sidebar.actions.manageGroupCalendar', { defaultValue: 'Manage calendar' })}
                  >
                    <Settings2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default TechnicianSidebar;
