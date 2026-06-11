export const isEnterpriseLoginWinbackHookAvailable = false;

export async function handleInactiveLoginWinback(): Promise<void> {
  // CE no-op stub. EE builds resolve @enterprise/lib/auth/loginWinback to ee/server/src.
}
