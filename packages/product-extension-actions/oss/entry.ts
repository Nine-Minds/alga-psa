// OSS stubs for Extension actions
export const validate = async (_params: any) => {
  throw new Error('Extension domain validation is an Enterprise Edition feature');
};

export const lookupByHost = async (_host: string) => {
  throw new Error('Extension domain lookup is an Enterprise Edition feature');
};

export const listAppMenuItemsForTenant = async () => {
  return [] as any[];
};

export type AppMenuItem = any;

export default {
  validate,
  lookupByHost,
  listAppMenuItemsForTenant,
};

