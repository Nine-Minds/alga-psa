export interface FuzzyMatcherClient {
  clientId: string;
  clientName: string;
}

export interface FuzzyMatchCandidate {
  clientId: string;
  clientName: string;
  confidenceScore: number;
  reason: 'fuzzy_name';
  autoMatch: false;
}

function normalizeName(value: string | null | undefined): string {
  if (!value) {
    return '';
  }

  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toBigrams(value: string): Set<string> {
  const normalized = normalizeName(value);
  if (!normalized) {
    return new Set<string>();
  }

  if (normalized.length < 2) {
    return new Set<string>([normalized]);
  }

  const grams = new Set<string>();
  for (let i = 0; i < normalized.length - 1; i += 1) {
    grams.add(normalized.slice(i, i + 2));
  }
  return grams;
}

export function calculateNameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const aBigrams = toBigrams(a || '');
  const bBigrams = toBigrams(b || '');

  if (aBigrams.size === 0 || bBigrams.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const gram of aBigrams) {
    if (bBigrams.has(gram)) {
      overlap += 1;
    }
  }

  return (2 * overlap) / (aBigrams.size + bBigrams.size);
}

export function findFuzzyClientCandidates(
  tenantDisplayName: string | null | undefined,
  clients: FuzzyMatcherClient[],
  options?: {
    minScore?: number;
    maxCandidates?: number;
  }
): FuzzyMatchCandidate[] {
  const minScore = options?.minScore ?? 0.58;
  const maxCandidates = options?.maxCandidates ?? 5;

  const candidates: FuzzyMatchCandidate[] = [];
  for (const client of clients) {
    const score = calculateNameSimilarity(tenantDisplayName, client.clientName);
    if (score < minScore) {
      continue;
    }

    candidates.push({
      clientId: client.clientId,
      clientName: client.clientName,
      confidenceScore: Number(score.toFixed(4)),
      reason: 'fuzzy_name',
      autoMatch: false,
    });
  }

  return candidates
    .sort((a, b) => b.confidenceScore - a.confidenceScore)
    .slice(0, maxCandidates);
}
