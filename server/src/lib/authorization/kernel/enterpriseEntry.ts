import type { AuthorizationKernel } from './contracts';

type EnterpriseKernelFactory = () => AuthorizationKernel | null | Promise<AuthorizationKernel | null>;

export async function loadEnterpriseAuthorizationKernelFactory(): Promise<EnterpriseKernelFactory | null> {
  try {
    const mod = await import('@enterprise/lib/authorization/kernel');
    const factory = (mod as Record<string, unknown>).createEnterpriseAuthorizationKernel;
    if (typeof factory !== 'function') {
      return null;
    }

    return factory as EnterpriseKernelFactory;
  } catch {
    return null;
  }
}
