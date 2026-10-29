import type { TemplateAst } from '@alga-psa/types';

type ManifestBindings = NonNullable<TemplateAst['bindings']>;
type ManifestValueBindings = NonNullable<ManifestBindings['values']>;
type ManifestCollectionBindings = NonNullable<ManifestBindings['collections']>;

/**
 * Bindings of the `staging-manifest` document (alga-2026-0002683 C6): what is in one project staging box.
 * Paths resolve against `StagingManifestViewModel` (`@alga-psa/types`), built by the projects package's
 * manifest provider. `recordUrl` is the box's canonical record URL, the only content of its QR code.
 */
export const STAGING_MANIFEST_VALUE_BINDINGS: ManifestValueBindings = {
  boxIdentifier: { id: 'boxIdentifier', kind: 'value', path: 'box.identifier' },
  boxName: { id: 'boxName', kind: 'value', path: 'box.name', fallback: '' },
  boxPosition: { id: 'boxPosition', kind: 'value', path: 'box.positionDisplay', fallback: '' },
  boxStatus: { id: 'boxStatus', kind: 'value', path: 'box.statusLabel', fallback: '' },
  sealedAt: { id: 'sealedAt', kind: 'value', path: 'box.sealedAt', fallback: '' },
  sealedBy: { id: 'sealedBy', kind: 'value', path: 'box.sealedBy', fallback: '' },
  boxLocation: { id: 'boxLocation', kind: 'value', path: 'box.location', fallback: '' },
  boxNotes: { id: 'boxNotes', kind: 'value', path: 'box.notes', fallback: '' },
  recordUrl: { id: 'recordUrl', kind: 'value', path: 'box.recordUrl' },
  projectNumber: { id: 'projectNumber', kind: 'value', path: 'project.number', fallback: '' },
  projectName: { id: 'projectName', kind: 'value', path: 'project.name', fallback: '' },
  clientName: { id: 'clientName', kind: 'value', path: 'project.clientName', fallback: '' },
  taskName: { id: 'taskName', kind: 'value', path: 'box.taskName', fallback: '' },
  itemCount: { id: 'itemCount', kind: 'value', path: 'itemCount' },
  tenantName: { id: 'tenantName', kind: 'value', path: 'tenantClient.name', fallback: '' },
  tenantLogo: { id: 'tenantLogo', kind: 'value', path: 'tenantClient.logo_url' },
};

export const STAGING_MANIFEST_COLLECTION_BINDINGS: ManifestCollectionBindings = {
  members: { id: 'members', kind: 'collection', path: 'members' },
};

export const buildStagingManifestTemplateBindings = (): ManifestBindings => ({
  values: { ...STAGING_MANIFEST_VALUE_BINDINGS },
  collections: { ...STAGING_MANIFEST_COLLECTION_BINDINGS },
});
