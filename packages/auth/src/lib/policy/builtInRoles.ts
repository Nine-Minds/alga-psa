// Roles seeded for every tenant. Code across the product finds these by name (admin
// notifications, default client-portal role, technician scheduling, product upgrades),
// so renaming one silently breaks those lookups.
const BUILT_IN_ROLE_NAMES = new Set([
  'admin',
  'finance',
  'technician',
  'project manager',
  'dispatcher',
  'manager',
  'user',
]);

export function isBuiltInRoleName(roleName: string): boolean {
  return BUILT_IN_ROLE_NAMES.has(roleName.trim().toLowerCase());
}
