import { MAX_LABELS_PER_REQUEST, type LabelClass } from '@alga-psa/types';

/**
 * The staging page's bulk print order (C6 D11), as one POST /api/labels/pdf label-subject list: for each box in
 * box order, the box label, then that box's unit labels (stock-unit-identity) and client-asset labels
 * (asset-identity); then staged items that are in no box. Quantity lines get no per-item label (they are
 * on the manifest). Unit labels are left out, and counted, when the user cannot read inventory, instead of
 * sending ids the server would refuse. Pure: no I/O.
 */

export interface PrintableMember {
  staging_line_id: string;
  kind: 'stock' | 'client_asset' | 'client_item';
  unit_id?: string | null;
  asset_id?: string | null;
}

export interface PrintableBox {
  container_id: string;
  sequence: number;
  members: PrintableMember[];
}

export interface PrintableLine extends PrintableMember {
  status: string;
  container_ids: string[];
}

export interface StagingPrintPlan {
  labels: Array<{ labelClass: LabelClass; recordId: string }>;
  /** Unit labels left out because the user lacks inventory:read. */
  droppedUnitLabels: number;
  /** True when the plan exceeds one print request: the user must choose fewer boxes. */
  overCap: boolean;
}

function memberLabel(member: PrintableMember): { labelClass: LabelClass; recordId: string } | null {
  if (member.kind === 'stock' && member.unit_id) return { labelClass: 'stock-unit-identity', recordId: member.unit_id };
  if (member.kind === 'client_asset' && member.asset_id) return { labelClass: 'asset-identity', recordId: member.asset_id };
  return null;
}

export function planStagingPrint(
  boxes: readonly PrintableBox[],
  lines: readonly PrintableLine[],
  options: { canReadInventory: boolean; boxIds?: readonly string[] | null; includeUnboxed?: boolean },
): StagingPrintPlan {
  const chosen = options.boxIds ? new Set(options.boxIds) : null;
  const labels: StagingPrintPlan['labels'] = [];
  let droppedUnitLabels = 0;
  const push = (member: PrintableMember) => {
    const label = memberLabel(member);
    if (!label) return;
    if (label.labelClass === 'stock-unit-identity' && !options.canReadInventory) {
      droppedUnitLabels += 1;
      return;
    }
    labels.push(label);
  };

  for (const box of [...boxes].sort((a, b) => a.sequence - b.sequence)) {
    if (chosen && !chosen.has(box.container_id)) continue;
    labels.push({ labelClass: 'staging-container', recordId: box.container_id });
    for (const member of box.members) push(member);
  }
  if (options.includeUnboxed !== false) {
    for (const line of lines) {
      if (line.status === 'staged' && line.container_ids.length === 0) push(line);
    }
  }
  return { labels, droppedUnitLabels, overCap: labels.length > MAX_LABELS_PER_REQUEST };
}
