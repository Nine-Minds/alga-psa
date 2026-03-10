import { dynamic, eeUnavailable } from '../../_stub';

export { dynamic };

export async function GET(): Promise<Response> {
  return eeUnavailable();
}

export async function POST(): Promise<Response> {
  return eeUnavailable();
}

export async function OPTIONS(): Promise<Response> {
  return eeUnavailable();
}
