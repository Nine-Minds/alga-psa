type LineCandidate = {
  client_contract_line_id: string;
  bucket_overlay?: {
    config_id: string;
  } | null;
};

export function resolveDeterministicContractLineSelection<T extends LineCandidate>(
  eligibleContractLines: T[]
): {
  selectedContractLineId: string | null;
  decision: 'explicit' | 'default' | 'ambiguous_or_unresolved';
  overlayCount: number;
} {
  if (eligibleContractLines.length === 0) {
    return {
      selectedContractLineId: null,
      decision: 'ambiguous_or_unresolved',
      overlayCount: 0,
    };
  }

  if (eligibleContractLines.length === 1) {
    return {
      selectedContractLineId: eligibleContractLines[0].client_contract_line_id,
      decision: 'explicit',
      overlayCount: Number(Boolean(eligibleContractLines[0].bucket_overlay?.config_id)),
    };
  }

  const overlayContractLines = eligibleContractLines.filter((contractLine) => contractLine.bucket_overlay?.config_id);
  if (overlayContractLines.length === 1) {
    return {
      selectedContractLineId: overlayContractLines[0].client_contract_line_id,
      decision: 'default',
      overlayCount: overlayContractLines.length,
    };
  }

  return {
    selectedContractLineId: null,
    decision: 'ambiguous_or_unresolved',
    overlayCount: overlayContractLines.length,
  };
}
