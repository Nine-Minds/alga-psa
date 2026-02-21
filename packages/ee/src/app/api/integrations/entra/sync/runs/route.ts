import { dynamic, eeUnavailable } from '../../_stub';

export { dynamic };

export async function GET(): Promise<Response> {
  return eeUnavailable();
}
