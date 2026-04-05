const BINDING_ALIASES: Record<string, string> = {
  'client.name': 'customer.name',
  'client.address': 'customer.address',
  'tenant.name': 'tenantClient.name',
  'tenant.address': 'tenantClient.address',
};

export const resolveInvoiceTemplateBindingAlias = (bindingPath: string): string => {
  const normalized = bindingPath.trim();
  if (!normalized) {
    return normalized;
  }
  return BINDING_ALIASES[normalized] ?? normalized;
};
