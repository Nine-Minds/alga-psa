/**
 * Extract plain text from a BlockNote JSON string.
 * Falls back to returning the raw value if it's not valid BlockNote JSON.
 */
function extractPlainText(raw: string): string {
  try {
    const blocks = JSON.parse(raw);
    if (!Array.isArray(blocks)) return raw;
    const lines: string[] = [];
    const extractFromContent = (content: unknown[]): string => {
      return content
        .map((item: any) => (typeof item?.text === 'string' ? item.text : ''))
        .join('');
    };
    for (const block of blocks) {
      if (block?.content && Array.isArray(block.content)) {
        const line = extractFromContent(block.content);
        lines.push(line);
      }
    }
    return lines.join('\n');
  } catch {
    return raw;
  }
}

export interface TaskPrefillFields {
  task_name: string;
  description: string;
  assigned_to: string | null;
  due_date: Date | null;
  estimated_hours: number;
}

interface TicketLike {
  title?: string | null;
  description?: string | null;
  assigned_to?: string | null;
  due_date?: string | null;
  priority_id?: string | null;
  attributes?: Record<string, unknown> | null;
}

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

export const mapTicketToTaskFields = (ticket: TicketLike | null | undefined): TaskPrefillFields => {
  const dueDate = ticket?.due_date ? new Date(ticket.due_date) : null;
  const rawDescription = ticket?.description ??
    (typeof ticket?.attributes?.description === 'string' ? ticket.attributes.description : '');
  const description = rawDescription ? extractPlainText(rawDescription) : '';
  return {
    task_name: ticket?.title ?? '',
    description,
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
  return {
    title: task?.task_name ?? '',
    description: task?.description ?? '',
    assigned_to: task?.assigned_to ?? null,
    due_date: task?.due_date ?? null,
    client_id: project?.client_id ?? null,
    client_name: project?.client_name ?? null
  };
};
