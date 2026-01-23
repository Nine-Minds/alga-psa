export type PathSegment =
  | { type: 'steps'; index: number }
  | { type: 'then' | 'else' | 'try' | 'catch' | 'body' };

const segmentRegex = /(steps)\[(\d+)\]|(then|else|try|catch|body)/g;

export function parseNodePath(path: string): PathSegment[] {
  if (!path || !path.startsWith('root')) {
    throw new Error(`Invalid nodePath: ${path}`);
  }
  const tokens: PathSegment[] = [];
  const matches = path.matchAll(segmentRegex);
  for (const match of matches) {
    if (match[1] === 'steps') {
      tokens.push({ type: 'steps', index: Number(match[2]) });
    } else if (match[3]) {
      tokens.push({ type: match[3] as 'then' | 'else' | 'try' | 'catch' | 'body' });
    }
  }
  return tokens;
}

export function buildStepsPath(prefix: string, index: number): string {
  return `${prefix}.steps[${index}]`;
}

export function isPathWithin(candidate: string, parent: string): boolean {
  if (!candidate || !parent) return false;
  return candidate === parent || candidate.startsWith(`${parent}.`);
}

export function pathDepth(path: string): number {
  return parseNodePath(path).length;
}
