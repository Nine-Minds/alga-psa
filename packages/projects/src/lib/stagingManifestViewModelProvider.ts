import { createTenantKnex } from '@alga-psa/db';
import type { StagingContainerMemberView, StagingContainerView } from '@alga-psa/inventory/lib/stagingContainers';
import { recordUrl, type IUserWithRoles, type StagingManifestMember, type StagingManifestViewModel } from '@alga-psa/types';

import { readAuthorizedStagingContainers } from './stagingLabelViewModelProvider';

/**
 * The packing manifest of one staging box (C6 D11): read-only, behind the same authorization as the box
 * label (`project:read` + record-level project read). Null for a missing, deleted or forbidden box alike.
 *
 * MSP stock units carry their full serial number (the manifest exists to check a box's contents at the
 * site; a serial is an identifier, not a credential). Client assets carry their tag and a serial suffix.
 */

export interface ManifestText {
  ownerMsp: string;
  ownerClient: string;
  statusOpen: string;
  statusSealed: string;
}

export const ENGLISH_MANIFEST_TEXT: ManifestText = {
  ownerMsp: 'MSP',
  ownerClient: 'Client',
  statusOpen: 'Open',
  statusSealed: 'Sealed',
};

const SERIAL_SUFFIX_LENGTH = 4;

function memberRow(member: StagingContainerMemberView, text: ManifestText): StagingManifestMember {
  switch (member.kind) {
    case 'client_asset': {
      const serial = member.asset_serial_number?.trim() ?? '';
      return {
        description: member.asset_name ?? member.description ?? '',
        sku: member.asset_tag ?? '',
        quantity: member.quantity,
        serial: serial ? `…${serial.slice(-SERIAL_SUFFIX_LENGTH)}` : '',
        owner: text.ownerClient,
        taskName: member.task_name ?? '',
      };
    }
    case 'client_item':
      return {
        description: member.description ?? '',
        sku: '',
        quantity: member.quantity,
        serial: '',
        owner: text.ownerClient,
        taskName: member.task_name ?? '',
      };
    default:
      return {
        description: member.service_name ?? '',
        sku: member.sku ?? '',
        quantity: member.quantity,
        serial: member.serial_number ?? '',
        owner: text.ownerMsp,
        taskName: member.task_name ?? '',
      };
  }
}

export function buildStagingManifestViewModel(
  container: StagingContainerView,
  baseUrl: string,
  text: ManifestText = ENGLISH_MANIFEST_TEXT,
): StagingManifestViewModel {
  const members = container.members.map((m) => memberRow(m, text));
  const location = [container.stock_location_name, container.location_note].filter(Boolean).join(', ');
  const sealedAt = container.sealed_at ? new Date(container.sealed_at as unknown as string).toISOString() : null;
  return {
    box: {
      identifier: container.identifier,
      name: container.name ?? null,
      positionDisplay: `${container.position.n} / ${container.position.total}`,
      sequence: { n: container.position.n, total: container.position.total },
      statusLabel: container.status === 'sealed' ? text.statusSealed : text.statusOpen,
      sealedAt,
      sealedBy: container.sealed_by_name ?? null,
      location: location || null,
      notes: container.notes ?? null,
      taskName: container.task_name ?? null,
      recordUrl: recordUrl('staging_container', container.container_id, baseUrl, { projectId: container.project_id }),
    },
    project: { number: container.project_number, name: container.project_name, clientName: container.client_name ?? null },
    itemCount: members.reduce((sum, m) => sum + m.quantity, 0),
    members,
  };
}

/** The manifest view model of one box, or null when the caller may not read it (or it does not exist). */
export async function getStagingManifestViewModel(
  context: { tenant: string; user: IUserWithRoles; baseUrl: string; text?: ManifestText },
  containerId: string,
): Promise<StagingManifestViewModel | null> {
  const { knex } = await createTenantKnex(context.tenant);
  const [container] = await readAuthorizedStagingContainers(knex, context.tenant, context.user, [containerId]);
  return container ? buildStagingManifestViewModel(container, context.baseUrl, context.text) : null;
}
