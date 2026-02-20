import { dynamic, ok, runtime } from '../_responses';

export { dynamic, runtime };

export async function POST(): Promise<Response> {
  return ok({
    status: 'disconnected',
  });
}
