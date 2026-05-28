export type AlgaDeskProviderDescriptor = {
  id: string;
  description: string;
};

export const ALGA_DESK_PROVIDER_STACK: readonly AlgaDeskProviderDescriptor[] = [
  { id: 'product-context', description: 'Tenant product resolution context' },
  { id: 'authorization', description: 'RBAC permission context' },
  { id: 'ticketing', description: 'Ticket collaboration context' },
  { id: 'portal-nav', description: 'Portal navigation context' },
] as const;
