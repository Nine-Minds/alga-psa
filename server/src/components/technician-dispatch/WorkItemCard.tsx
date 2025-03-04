import React from 'react';
import { WorkItemType } from 'server/src/interfaces/workItem.interfaces';

interface WorkItemCardProps {
  ticketNumber?: string;
  priority?: string;
  client?: string;
  subject?: string;
  title?: string;
  description?: string;
  type?: WorkItemType;
  isBillable?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}

const WorkItemCard: React.FC<WorkItemCardProps> = ({ 
  ticketNumber, 
  priority, 
  client, 
  subject,
  title,
  description,
  type,
  isBillable,
  onClick
}) => {
  return (
    <div 
      className="bg-white p-2 rounded cursor-pointer hover:bg-gray-50 transition-colors"
      onClick={onClick}
    >
      {title ? (
        <>
          <div className="font-bold">{title}</div>
          <div className="text-sm">{description}</div>
          <div className="mt-1 flex justify-between gap-2 text-xs text-gray-500">
            <span className={`inline-flex w-max items-center px-2 py-0.5 rounded-full font-medium ${
              type === 'ticket' 
                ? 'bg-[rgb(var(--color-primary-200))] text-[rgb(var(--color-primary-900))]' 
                : type === 'project_task' 
                  ? 'bg-[rgb(var(--color-secondary-100))] text-[rgb(var(--color-secondary-900))]' 
                  : 'bg-[rgb(var(--color-border-200))] text-[rgb(var(--color-border-900))]'
            }`}>
              {type === 'ticket' ? 'Ticket' : 
               type === 'ad_hoc' ? 'Ad Hoc' :
               type === 'project_task' ? 'Project Task' :
               type === 'non_billable_category' ? 'Non-Billable' : 
               'Unknown Type'}
            </span>
            <span className={`inline-flex w-max items-center px-2 py-0.5 rounded-full font-medium ${
              isBillable 
                ? 'bg-[rgb(var(--color-accent-100))] text-[rgb(var(--color-accent-800))]' 
                : 'bg-[rgb(var(--color-border-200))] text-[rgb(var(--color-border-900))]'
            }`}>
              {isBillable ? 'Billable' : 'Non-billable'}
            </span>
          </div>
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
  );
};

export default WorkItemCard;
