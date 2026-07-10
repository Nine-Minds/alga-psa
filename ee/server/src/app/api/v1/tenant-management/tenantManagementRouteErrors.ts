export interface TenantManagementRouteError {
  error: string;
  status: number;
}

export function tenantManagementRouteError(
  error: unknown,
  fallback: string
): TenantManagementRouteError {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';

  if (error instanceof SyntaxError) {
    return { error: 'Invalid JSON request body.', status: 400 };
  }

  if (message === 'Unauthorized') {
    return { error: 'Unauthorized', status: 401 };
  }

  if (message === 'Invalid API key') {
    return { error: 'Invalid API key', status: 401 };
  }

  if (message === 'Forbidden' || message.includes('Access denied') || message.includes('Authentication')) {
    return { error: 'Forbidden', status: 403 };
  }

  if (message.startsWith('Invalid productCode')) {
    return { error: 'Invalid product code.', status: 400 };
  }

  if (message.endsWith(' is required')) {
    return { error: 'A required field is missing.', status: 400 };
  }

  if (message.startsWith('Invalid ')) {
    return { error: 'Invalid request.', status: 400 };
  }

  if (message === 'MASTER_BILLING_TENANT_ID not configured') {
    return { error: 'Tenant management is not configured.', status: 500 };
  }

  return { error: fallback, status: 500 };
}
