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

describe('UserDetails work schedule save flow', () => {
  it('validates the schedule with the shared parser before saving user fields', () => {
    const validationAt = handleSave.indexOf('parseWorkSchedule(workSchedule)');
    const userSaveAt = handleSave.indexOf('await updateUser(user.user_id, updatedUserData)');

    expect(validationAt).toBeGreaterThanOrEqual(0);
    expect(userSaveAt).toBeGreaterThan(validationAt);
    expect(handleSave).toContain('if (!parsedSchedule.ok) {');
    expect(handleSave).toContain("toast.error(t('userDetails.messages.error.invalidWorkSchedule'));");
  });

  it('only writes the schedule when it changed and surfaces a failed write', () => {
    expect(handleSave).toContain('await updateUserWorkSchedule(user.user_id, parsedSchedule.value)');
    expect(handleSave).toContain('if (!scheduleResult.success) {');

    const failureAt = handleSave.indexOf('if (!scheduleResult.success) {');
    const closeAt = handleSave.indexOf('closeDrawer();');
    expect(closeAt).toBeGreaterThan(failureAt);
  });

  it('offers a weekday default whose days-off still satisfy the table CHECK', () => {
    const defaults = source.slice(source.indexOf('function defaultWorkSchedule()'));
    expect(defaults).toContain('isWorking: dayOfWeek >= 1 && dayOfWeek <= 5');
    // Weekends keep a real window; end_time > start_time is enforced in SQL.
    expect(defaults).toContain("startTime: '09:00'");
    expect(defaults).toContain("endTime: '17:00'");
  });

  it('labels the weekly capacity field as a fallback, not a second schedule', () => {
    const en = JSON.parse(
      fs.readFileSync(path.join(root, 'server/public/locales/en/msp/settings.json'), 'utf8'),
    );
    const fields = en.userDetails.fields;
    expect(fields.workSchedule.help).toContain('not client booking availability');
    expect(fields.weeklyCapacity.help).toContain('Fallback');
  });
});
