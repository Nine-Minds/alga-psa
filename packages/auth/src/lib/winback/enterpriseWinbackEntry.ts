export type InactiveLoginWinbackHookInput = {
  tenantId: string;
};

export type InactiveLoginWinbackHook = (
  input: InactiveLoginWinbackHookInput,
) => Promise<void>;

export async function loadEnterpriseInactiveLoginWinbackHook(): Promise<InactiveLoginWinbackHook | null> {
  try {
    const winback = await import('@enterprise/lib/auth/loginWinback');
    const hook = (winback as any).handleInactiveLoginWinback;

    if (
      typeof hook !== 'function' ||
      (winback as any).isEnterpriseLoginWinbackHookAvailable !== true
    ) {
      return null;
    }

    return hook as InactiveLoginWinbackHook;
  } catch {
    return null;
  }
}
