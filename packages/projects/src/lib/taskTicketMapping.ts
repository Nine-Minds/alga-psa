import { ITicket } from '@alga-psa/types';

export interface TaskPrefillFields {
  task_name: string;
  description: string;
  assigned_to: string | null;
  due_date: Date | null;
  estimated_hours: number;
}

type TicketLike = Pick<ITicket, 'title' | 'description' | 'assigned_to' | 'due_date'> & {
  priority_id?: string | null;
};

export interface TicketPrefillFields {
  title: string;
  description: string;
  assigned_to: string | null;
  due_date: Date | null;
  client_id: string | null;
  client_name?: string | null;
}

interface ProjectLike {
  client_id: string | null;
  client_name?: string | null;
}

export const mapTicketToTaskFields = (ticket: Partial<TicketLike> | null | undefined): TaskPrefillFields => {
  const { priority_id: _ignoredPriority } = ticket ?? {};
  const dueDate = ticket?.due_date ? new Date(ticket.due_date) : null;
  return {
    task_name: ticket?.title ?? '',
    description: ticket?.description ?? '',
    assigned_to: ticket?.assigned_to ?? null,
    due_date: dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate : null,
    estimated_hours: 0
  };
};

export const mapTaskToTicketPrefill = (
  task: {
    task_name?: string | null;
    description?: string | null;
    assigned_to?: string | null;
    due_date?: Date | null;
    priority_id?: string | null;
  } | null | undefined,
  project: ProjectLike | null | undefined
): TicketPrefillFields => {
  const { priority_id: _ignoredPriority } = task ?? {};
  return {
    title: task?.task_name ?? '',
    description: task?.description ?? '',
    assigned_to: task?.assigned_to ?? null,
    due_date: task?.due_date ?? null,
    client_id: project?.client_id ?? null,
    client_name: project?.client_name ?? null
  };
};
