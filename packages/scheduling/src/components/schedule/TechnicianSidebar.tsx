'use client'

import React, { useMemo } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { CalendarDays, Layers, Layers2, XCircle } from 'lucide-react';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';

interface TechnicianSidebarProps {
  technicians: IUserWithRoles[];
  focusedTechnicianId: string | null;
  comparisonTechnicianIds: string[];
  onSetFocus: (technicianId: string) => void;
  onComparisonChange: (technicianId: string, add: boolean) => void;
  onResetSelections?: () => void;
  onSelectAll?: () => void;
}

const TechnicianSidebar: React.FC<TechnicianSidebarProps> = ({
  technicians,
  focusedTechnicianId,
  comparisonTechnicianIds,
  onSetFocus,
  onComparisonChange,
  onResetSelections,
  onSelectAll
}) => {

  const internalTechnicians = useMemo(() => {
    return technicians
      .filter(tech => tech.user_type === 'internal')
      .sort((a, b) => {
        const nameA = `${a.first_name || ''} ${a.last_name || ''}`.toLowerCase();
        const nameB = `${b.first_name || ''} ${b.last_name || ''}`.toLowerCase();
        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;
        return 0;
      });
  }, [technicians]);
  return (
    <div className="w-64 flex-shrink-0 bg-white border border-gray-200 rounded-lg overflow-y-auto">
      <div className="p-2 border-gray-200">
        <div className="flex justify-center gap-1">
          <Button
            id="select-all-button"
            variant="outline"
            size="sm"
            onClick={onSelectAll}
            className="text-xs px-2 py-1 h-7"
          >
            <Layers className="h-4 w-4 mr-1" />
            Compare All
          </Button>
          <Button
            id="reset-selections-button"
            variant="outline"
            size="sm"
            onClick={onResetSelections}
            className="text-xs px-2 py-1 h-7"
            disabled={!focusedTechnicianId && comparisonTechnicianIds.length === 0}
          >
            <XCircle className="h-4 w-4 mr-1" />
            Clear All
          </Button>
        </div>
      </div>
      {internalTechnicians.map(tech => {
        const isFocus = tech.user_id === focusedTechnicianId;
        const isComparing = comparisonTechnicianIds.includes(tech.user_id);
        const isInactive = tech.is_inactive;

        return (
          <div
            key={tech.user_id}
            className={`h-16 mb-4 flex items-center justify-between pl-2 rounded-md ${
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
            <span className="truncate">
              {tech.first_name} {tech.last_name}
              {isInactive && <span className="ml-1 text-xs">(Inactive)</span>}
            </span>
            <div className="flex items-center flex-shrink-0">
              {!isFocus && (
                <Button
                  id={`view-week-${tech.user_id}`}
                  variant="ghost"
                  size="sm"
                  onClick={() => onSetFocus(tech.user_id)}
                  tooltipText="View Week"
                  tooltip={true}
                  aria-label={`View week for ${tech.first_name} ${tech.last_name}`}
                >
                  <CalendarDays className="h-4 w-4" />
                </Button>
              )}
              {!isFocus && (
                <Button
                  id={`compare-tech-${tech.user_id}`}
                  variant={isComparing ? "default" : "ghost"}
                  size="sm"
                  onClick={() => onComparisonChange(tech.user_id, !isComparing)}
                  tooltipText={isComparing ? "Stop Comparing" : "Compare"}
                  tooltip={true}
                  aria-label={`Compare ${tech.first_name} ${tech.last_name}`}
                >
                  <Layers2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default TechnicianSidebar;
