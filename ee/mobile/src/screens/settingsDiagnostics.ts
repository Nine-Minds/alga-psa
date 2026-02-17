export function formatAppVersion(version: string | null | undefined, build: string | null | undefined): string {
  const v = version ?? "unknown";
  const b = build ?? "unknown";
  return `${v} (${b})`;
}

