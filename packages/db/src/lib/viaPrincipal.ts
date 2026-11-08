/** Adds provenance only when delegation is present; row defaults remain intact otherwise. */
export function withViaPrincipal<T extends object>(
  ctx: { viaPrincipalUserId?: string | null },
  row: T,
  columns: string | readonly string[] = 'via_principal_id'
): T {
  if (!ctx.viaPrincipalUserId) return row;
  const via: Record<string, string> = {};
  for (const column of typeof columns === 'string' ? [columns] : columns) {
    via[column] = ctx.viaPrincipalUserId;
  }
  return { ...row, ...via };
}
