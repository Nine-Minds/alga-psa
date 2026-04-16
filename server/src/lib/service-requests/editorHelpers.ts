import type { ITicketCategory } from '@alga-psa/types';

const TICKET_ROUTING_EXECUTION_CONFIG_KEYS = [
  'boardId',
  'statusId',
  'priorityId',
  'categoryId',
  'subcategoryId',
  'assignedToUserId',
  'itilImpact',
  'itilUrgency',
  'titleFieldKey',
  'descriptionPrefix',
] as const;

export function getServiceRequestDraftLifecycleLabel(
  lifecycleState: string | null | undefined,
  hasLivePublishedVersion: boolean
): string | undefined {
  if (!lifecycleState) {
    return undefined;
  }

  if (lifecycleState === 'draft' && hasLivePublishedVersion) {
    return 'draft changes';
  }

  if (lifecycleState === 'published') {
    return 'published/live';
  }

  return lifecycleState;
}

export interface TicketRoutingConfigInput {
  boardId: string;
  statusId: string;
  priorityId: string;
  categoryId: string;
  subcategoryId: string;
  assignedToUserId: string;
  itilImpact: string;
  itilUrgency: string;
  titleFieldKey: string;
  descriptionPrefix: string;
}

interface BuildTicketRoutingExecutionConfigInput {
  existingExecutionConfig?: Record<string, unknown> | null;
  ticketRoutingConfigInput: TicketRoutingConfigInput;
  selectedCategory?: Pick<ITicketCategory, 'category_id' | 'parent_category'> | undefined;
  boardPriorityType?: 'custom' | 'itil' | null;
}

export function buildTicketRoutingExecutionConfig({
  existingExecutionConfig,
  ticketRoutingConfigInput,
  selectedCategory,
  boardPriorityType,
}: BuildTicketRoutingExecutionConfigInput): Record<string, unknown> {
  const nextExecutionConfig: Record<string, unknown> = {
    ...(existingExecutionConfig ?? {}),
  };

  for (const key of TICKET_ROUTING_EXECUTION_CONFIG_KEYS) {
    delete nextExecutionConfig[key];
  }

  const addStringConfig = (key: string, value: string) => {
    const trimmedValue = value.trim();
    if (trimmedValue.length > 0) {
      nextExecutionConfig[key] = trimmedValue;
    }
  };

  addStringConfig('boardId', ticketRoutingConfigInput.boardId);
  addStringConfig('statusId', ticketRoutingConfigInput.statusId);
  addStringConfig('priorityId', ticketRoutingConfigInput.priorityId);
  addStringConfig('assignedToUserId', ticketRoutingConfigInput.assignedToUserId);
  addStringConfig('titleFieldKey', ticketRoutingConfigInput.titleFieldKey);
  addStringConfig('descriptionPrefix', ticketRoutingConfigInput.descriptionPrefix);

  if (selectedCategory) {
    if (selectedCategory.parent_category) {
      nextExecutionConfig.categoryId = selectedCategory.parent_category;
      nextExecutionConfig.subcategoryId = selectedCategory.category_id;
    } else {
      nextExecutionConfig.categoryId = selectedCategory.category_id;
    }
  }

  if (boardPriorityType === 'itil') {
    const impact = Number.parseInt(ticketRoutingConfigInput.itilImpact, 10);
    const urgency = Number.parseInt(ticketRoutingConfigInput.itilUrgency, 10);

    if (Number.isInteger(impact)) {
      nextExecutionConfig.itilImpact = impact;
    }

    if (Number.isInteger(urgency)) {
      nextExecutionConfig.itilUrgency = urgency;
    }
  }

  return nextExecutionConfig;
}
