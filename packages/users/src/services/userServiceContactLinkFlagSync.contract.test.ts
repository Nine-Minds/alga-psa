/**
 * alga-2026-0003347 for the writes that move a user instead of its roles.
 *
 * `contacts.is_client_admin` mirrors the client portal 'Admin' role, and the
 * portal visibility resolver widens a flagged contact's ticket, asset and
 * project scope to the whole client on it. PUT /api/v1/users/{id} accepts
 * `contact_id` and `user_type` (userSchemas.updateUserSchema), and neither
 * writes a role — but both change what the roles the account already holds mean
 * for a contact. A 'User'-role account pointed at a flagged contact kept that
 * contact's company-wide portal scope, which is the leak this card closes.
 *
 * UserService.ts cannot be imported at runtime (its `../controllers/types` and
 * `../schemas/userSchemas` live in server/), which is why every suite for this
 * file is contract-style: the wiring is asserted on the source, and the
 * re-derivation it calls is covered behaviourally in
 * packages/db/src/lib/clientPortalAdminFlag.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'UserService.ts'), 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('user service contact-link portal admin flag contract', () => {
  it('imports the shared re-derivation rather than deriving the flag itself', () => {
    expect(source).toContain('syncContactClientAdminFlagsForUserLinkChange');
    expect(source).not.toContain('is_client_admin:');
  });

  it('re-derives both contacts after an update that changed the link or the user type', () => {
    const section = sectionBetween('async update(id: string', 'Delete user with proper cleanup');

    // The pre-image is read in the same transaction, so the contact the user
    // left can be re-derived too.
    expect(section).toContain("'user_id', 'email', 'user_type', 'is_inactive', 'contact_id'");

    const guard = section.indexOf("'contact_id' in updateData || 'user_type' in updateData");
    const write = section.indexOf('.update(updateData)');
    const sync = section.indexOf('await syncContactClientAdminFlagsForUserLinkChange(');

    expect(guard).toBeGreaterThan(0);
    // After the write, inside the same transaction: the flag commits with it.
    expect(write).toBeLessThan(guard);
    expect(sync).toBeGreaterThan(guard);
    expect(section.slice(sync)).toContain('existingUser.contact_id ?? null');
  });
});
