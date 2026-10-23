export function getMicrosoftSenderDeleteBlockMessage(emailAddress?: string | null): string | null {
  if (!emailAddress) return null;
  return `Cannot delete this Microsoft mailbox while sender ${emailAddress} uses it. Reassign or delete that sender first.`;
}
