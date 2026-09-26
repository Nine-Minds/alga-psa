/**
 * Development worktrees may share a user table. Only initialize a generated
 * development password when the account does not already have one.
 */
export function shouldInitializeDevelopmentPassword(
  existingHash: string | null | undefined,
): boolean {
  return !existingHash;
}
