/**
 * The single definition of what an MSP user must hold to use "submit a service request on behalf of a
 * client contact". Server actions, the API controller, the page and every entry point (Quick Create,
 * sidebar, client/contact pages, landing page) import from here so the gate cannot drift.
 *
 * Why these and not `service:*`: `service:*` controls authoring of the service catalog (admin-only by
 * default). Submitting a request creates a ticket for a client contact, so it is gated on
 * `ticket:create`, plus the client/contact reads needed to pick and resolve the contact. Every
 * technician-type default role already holds all three. No new permission resource is introduced.
 *
 * Pure module (no server imports): safe to use from client components.
 */

export interface MspSubmitPermission {
  readonly resource: string;
  readonly action: string;
}

/** Submit (action and `POST /api/v1/service-requests/{definitionId}/submissions`). */
export const MSP_SUBMIT_PERMISSIONS: readonly MspSubmitPermission[] = [
  { resource: 'ticket', action: 'create' },
  { resource: 'client', action: 'read' },
  { resource: 'contact', action: 'read' },
];

/** Catalog and pickers (definitions for a contact, form load, client/contact lookup, `GET .../catalog`). */
export const MSP_CATALOG_PERMISSIONS: readonly MspSubmitPermission[] = [
  { resource: 'client', action: 'read' },
  { resource: 'contact', action: 'read' },
];

export const permissionKey = (p: MspSubmitPermission): string => `${p.resource}:${p.action}`;

/** `resource:action` strings for a permission set (for menu config / granted-permission lists). */
export const MSP_SUBMIT_PERMISSION_KEYS: readonly string[] = MSP_SUBMIT_PERMISSIONS.map(permissionKey);

/** True when a granted `resource:action` list (e.g. `getCurrentUserPermissions()`) covers the set. */
export function grantsAllPermissions(
  granted: readonly string[],
  required: readonly MspSubmitPermission[] = MSP_SUBMIT_PERMISSIONS
): boolean {
  return required.every((p) => granted.includes(permissionKey(p)));
}

/** First permission in the set the checker denies, or null when all are held. */
export async function findMissingPermission(
  check: (resource: string, action: string) => Promise<boolean>,
  required: readonly MspSubmitPermission[]
): Promise<MspSubmitPermission | null> {
  for (const p of required) {
    if (!(await check(p.resource, p.action))) return p;
  }
  return null;
}
