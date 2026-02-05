import type { IInteraction, TimeEntryWorkItemContext } from '@alga-psa/types';

export function buildInteractionTimeEntryContext(interaction: IInteraction): TimeEntryWorkItemContext {
  return {
    workItemId: interaction.interaction_id,
    workItemType: 'interaction',
    workItemName: interaction.title || interaction.type_name,
    interactionType: interaction.type_name,
    clientName: interaction.client_name ?? null,
    startTime: interaction.start_time ? new Date(interaction.start_time) : undefined,
    endTime: interaction.end_time ? new Date(interaction.end_time) : undefined,
  };
}
