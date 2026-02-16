let baseId: string | null = null;
let counter = 0;

function getBaseId(): string {
  if (baseId) return baseId;
  const rand = Math.random().toString(36).slice(2);
  baseId = `${Date.now().toString(36)}-${rand}`;
  return baseId;
}

export function nextCorrelationId(): string {
  counter += 1;
  return `${getBaseId()}.${counter}`;
}

