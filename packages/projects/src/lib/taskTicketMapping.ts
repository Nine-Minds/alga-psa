import { ITicket } from '@alga-psa/types';

export interface TaskPrefillFields {
  task_name: string;
  description: string;
  assigned_to: string | null;
  due_date: Date | null;
  estimated_hours: number;
}

type TicketLike = Pick<ITicket, 'title' | 'description' | 'assigned_to' | 'due_date' | 'estimated_hours'>;

export const mapTicketToTaskFields = (ticket: Partial<TicketLike> | null | undefined): TaskPrefillFields => {
  const dueDate = ticket?.due_date ? new Date(ticket.due_date) : null;
  return {
    task_name: ticket?.title ?? '',
    description: ticket?.description ?? '',
    assigned_to: ticket?.assigned_to ?? null,
    due_date: dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate : null,
    estimated_hours: typeof ticket?.estimated_hours === 'number' ? ticket.estimated_hours : 0
  };
};
