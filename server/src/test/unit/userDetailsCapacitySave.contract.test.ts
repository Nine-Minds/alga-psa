import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../../../..');
const source = fs.readFileSync(
  path.join(root, 'server/src/components/settings/general/UserDetails.tsx'),
  'utf8',
);

const handleSave = (() => {
  const start = source.indexOf('const handleSave = async () => {');
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf('const handleAdminChangePassword', start);
  return source.slice(start, end);
})();

describe('UserDetails weekly capacity save flow', () => {
  it('validates the capacity with the shared parser before saving user fields', () => {
    const validationAt = handleSave.indexOf('parseWeeklyCapacityHours(weeklyCapacity)');
    const userSaveAt = handleSave.indexOf('await updateUser(user.user_id, updatedUserData)');

    expect(validationAt).toBeGreaterThanOrEqual(0);
    expect(userSaveAt).toBeGreaterThan(validationAt);
    expect(handleSave).toContain('if (!parsedCapacity.ok) {');
    expect(handleSave).toContain("toast.error(t('userDetails.messages.error.invalidCapacity'));");
  });

  it('only writes capacity when it changed and surfaces a failed write', () => {
    expect(handleSave).toContain('if (parsedCapacity.value !== savedCapacity) {');
    expect(handleSave).toContain('await updateUserCapacity(user.user_id, parsedCapacity.value)');
    expect(handleSave).toContain('if (!capacityResult.success) {');

    // A failed capacity write must return before the success path closes the drawer.
    const failureAt = handleSave.indexOf('if (!capacityResult.success) {');
    const closeAt = handleSave.indexOf('closeDrawer();');
    expect(closeAt).toBeGreaterThan(failureAt);
  });

  it('loads the stored capacity and remembers it as the saved value', () => {
    expect(source).toContain('const capacity = capacityResult.data.maxWeeklyCapacity ?? null;');
    expect(source).toContain('setSavedCapacity(capacity);');
    expect(source).toContain("setWeeklyCapacity(capacity != null ? String(capacity) : '');");
  });
});
