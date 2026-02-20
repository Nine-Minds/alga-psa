import { dynamic, ok, runtime } from '../../_responses';

export { dynamic, runtime };

export async function GET(): Promise<Response> {
  return ok({
    autoMatched: [],
    fuzzyCandidates: [],
    unmatched: [],
  });
}
