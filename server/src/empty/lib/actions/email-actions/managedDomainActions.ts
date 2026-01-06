export interface ManagedDomainStatus {
  domain: string;
  status: 'pending' | 'verified' | 'failed' | string;
  updatedAt?: string | null;
  failureReason?: string | null;
}

export async function getManagedEmailDomains(): Promise<ManagedDomainStatus[]> {
  const error = new Error('Managed email domains are only available in the Enterprise edition.') as Error & {
    code?: string;
  };
  error.code = 'MODULE_NOT_FOUND';
  throw error;
}
