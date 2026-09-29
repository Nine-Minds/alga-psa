/**
 * A (client, service) can be eligible for more than one contract line, and those
 * lines frequently share a name — e.g. two "Managed Services" lines on two
 * different contracts. The Usage Tracking "Add Usage" dialog offers them in a
 * dropdown; if the visible labels are identical the operator cannot tell which
 * one they are billing against, and picking the wrong line silently misroutes
 * the charge.
 *
 * `buildEligibleContractLineOptions` guarantees every option carries a visibly
 * distinct label while preserving each line's own id as the option value (the
 * value that persists onto the usage record). Disambiguation escalates only as
 * far as needed: base `name (type)` → append contract identity when the base
 * collides → append a short id suffix in the (rare) case the contract name is
 * missing or also collides. Lines whose base label is already unique keep the
 * clean label.
 */

export interface EligibleContractLineOptionInput {
  client_contract_line_id: string;
  contract_line_name: string;
  contract_line_type: string;
  contract_name?: string | null;
}

export interface ContractLineOption {
  value: string;
  label: string;
}

function tally(labels: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const label of labels) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return counts;
}

export function buildEligibleContractLineOptions(
  lines: EligibleContractLineOptionInput[],
): ContractLineOption[] {
  const baseLabelOf = (line: EligibleContractLineOptionInput) =>
    `${line.contract_line_name} (${line.contract_line_type})`;

  const baseCounts = tally(lines.map(baseLabelOf));

  // First escalation: where the base label collides, fold in the contract
  // identity so the operator can see which contract the line belongs to.
  const withContractIdentity = lines.map((line) => {
    const base = baseLabelOf(line);
    const contractName = line.contract_name?.trim();
    const label =
      (baseCounts.get(base) ?? 0) > 1 && contractName
        ? `${base} — ${contractName}`
        : base;
    return { line, label };
  });

  // Second escalation: any label that STILL collides (missing or duplicate
  // contract names) gets a stable short-id suffix, which is always unique.
  const labelCounts = tally(withContractIdentity.map((entry) => entry.label));

  return withContractIdentity.map(({ line, label }) => ({
    value: line.client_contract_line_id,
    label:
      (labelCounts.get(label) ?? 0) > 1
        ? `${label} — #${line.client_contract_line_id.slice(0, 8)}`
        : label,
  }));
}
