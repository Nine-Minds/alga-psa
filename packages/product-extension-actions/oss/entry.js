// OSS stub implementation for Extension actions

// Stub for installDomainActions
export const validate = async (params) => {
  throw new Error('Extension domain validation is an Enterprise Edition feature');
};

export const lookupByHost = async (host) => {
  throw new Error('Extension domain lookup is an Enterprise Edition feature');
};

// Stub for extMenuActions
export const listAppMenuItemsForTenant = async () => {
  return [];
};

// Type definition for OSS compatibility
export const AppMenuItem = undefined;

// Default export
export default {
  validate,
  lookupByHost,
  listAppMenuItemsForTenant,
  AppMenuItem,
};
