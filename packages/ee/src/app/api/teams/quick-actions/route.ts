import { dynamic, eeUnavailable } from '../_stub';

export { dynamic };

export async function POST(): Promise<Response> {
  return eeUnavailable();
}
