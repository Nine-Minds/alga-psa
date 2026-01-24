export type ContractSubTab = 'templates' | 'client-contracts' | 'drafts';

export const CONTRACT_SUBTAB_LABELS: Record<ContractSubTab, string> = {
  templates: 'Templates',
  'client-contracts': 'Client Contracts',
  drafts: 'Drafts',
};

export const CONTRACT_TAB_LABELS: readonly string[] = [
  CONTRACT_SUBTAB_LABELS.templates,
  CONTRACT_SUBTAB_LABELS['client-contracts'],
  CONTRACT_SUBTAB_LABELS.drafts,
];

export const CONTRACT_LABEL_TO_SUBTAB: Record<string, ContractSubTab> = Object.fromEntries(
  Object.entries(CONTRACT_SUBTAB_LABELS).map(([subtab, label]) => [label, subtab as ContractSubTab])
) as Record<string, ContractSubTab>;

export const normalizeContractSubtab = (raw: string | null | undefined): ContractSubTab => {
  if (raw === 'client-contracts' || raw === 'drafts' || raw === 'templates') {
    return raw;
  }
  return 'templates';
};

export const getDraftTabBadgeCount = (draftCount: number): number | null =>
  draftCount > 0 ? draftCount : null;
