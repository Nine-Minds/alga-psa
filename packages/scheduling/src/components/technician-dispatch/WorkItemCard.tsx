import React from 'react';
import { WorkItemType } from '@alga-psa/types';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { cn } from '@alga-psa/ui';

interface WorkItemCardProps {
  ticketNumber?: string;
  priority?: string;
  client?: string;
  subject?: string;
  title?: string;
  description?: string;
  type?: WorkItemType;
  // isBillable?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  needsDispatch?: boolean;
  agentsNeedingDispatch?: { user_id: string; first_name: string | null; last_name: string | null }[];
}

const WorkItemCard: React.FC<WorkItemCardProps> = ({
  ticketNumber,
  priority,
  client,
  subject,
  title,
  description,
  type,
  // isBillable,
  onClick,
  needsDispatch,
  agentsNeedingDispatch
}) => {
  return (
    <div
      className="bg-white p-2 rounded cursor-pointer hover:bg-gray-50 transition-colors flex flex-col gap-1"
      onClick={onClick}
    >
      {/* Title & Description Area */}
      <div className="min-w-0">
        {title ? (
          <>
            <div className="font-bold truncate">{title}</div>
            <div className="text-sm text-gray-600 truncate">{description}</div>
          </>
        ) : (
          <>
            <div className="font-bold">{ticketNumber}</div>
            <div className="text-sm text-gray-600">{priority}</div>
            <div className="text-sm">{subject}</div>
            {client && <div className="text-xs text-gray-500">{client}</div>}
          </>
        )}
      </div>

      {/* Badges Area - Aligned Right */}
      <div className="flex justify-end space-x-1">
        {needsDispatch && (
          <Tooltip content={`Needs dispatch for: ${agentsNeedingDispatch?.map(agent => `${agent.first_name || ''} ${agent.last_name || ''}`.trim()).filter(Boolean).join(', ') || 'Unknown Agent'}`}>
            <div>
              <span className="block lg:hidden w-4 h-4 bg-red-200 rounded-full align-middle"></span>
              <Badge variant="error" className={cn(
                "hidden lg:inline-flex border-none",
                "bg-red-100 text-red-800"
              )}>
                Needs Dispatch
              </Badge>
            </div>
          </Tooltip>
        )}
        {/* Billable badge structure kept for future use, but logic removed */}
        {/*
        {typeof isBillable !== 'undefined' && (
           <div>
             <span className={cn(
               "block lg:hidden w-4 h-4 rounded-full align-middle",
               isBillable ? 'bg-yellow-200' : 'bg-gray-100'
             )}></span>
             <Badge variant={isBillable ? 'warning' : 'default'} className={cn(
               "hidden lg:inline-flex border-none",
               isBillable
                 ? "bg-yellow-100 text-yellow-800"
                 : "bg-gray-100 text-gray-800"
             )}>
               {isBillable ? 'Billable' : 'Non-billable'}
             </Badge>
           </div>
        )}
        */}
      </div>
    </div>
  );
};

export default WorkItemCard;
