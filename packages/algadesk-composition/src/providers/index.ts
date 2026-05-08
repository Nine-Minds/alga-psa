export type AlgadeskProviderDescriptor = {
  id: string;
  description: string;
};

export const ALGADESK_PROVIDER_STACK: readonly AlgadeskProviderDescriptor[] = [
  { id: 'product-context', description: 'Tenant product resolution context' },
  { id: 'authorization', description: 'RBAC permission context' },
  { id: 'ticketing', description: 'Ticket collaboration context' },
  { id: 'portal-nav', description: 'Portal navigation context' },
] as const;
