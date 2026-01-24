export function generateIdempotencyKey(
  runId: string,
  stepPath: string,
  actionId: string,
  version: number,
  input: unknown
): string {
  const base = JSON.stringify({ runId, stepPath, actionId, version, input });
  return `${runId}:${stepPath}:${actionId}:${version}:${hashString(base)}`;
}

export function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
