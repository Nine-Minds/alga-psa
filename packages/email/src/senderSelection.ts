export const DEFAULT_SENDER_SELECTION = '__default__';

export interface SelectableSender {
  sender_id: string;
  email_address: string;
}

export function buildSenderOptions(senders: SelectableSender[], effectiveAddress: string, useDefaultLabel: string) {
  return [
    { value: DEFAULT_SENDER_SELECTION, label: `${useDefaultLabel} (${effectiveAddress})` },
    ...senders.map((sender) => ({ value: sender.sender_id, label: sender.email_address })),
  ];
}

export function senderIdForSend(selection: string | null | undefined): string | undefined {
  return !selection || selection === DEFAULT_SENDER_SELECTION ? undefined : selection;
}
