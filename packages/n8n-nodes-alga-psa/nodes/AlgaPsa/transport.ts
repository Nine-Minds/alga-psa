import type {
  IDataObject,
  IExecuteFunctions,
  IHttpRequestMethods,
  IHttpRequestOptions,
  ILoadOptionsFunctions,
} from 'n8n-workflow';

export interface AlgaPsaCredentials {
  baseUrl: string;
  apiKey: string;
}

type RequestFunctions = IExecuteFunctions | ILoadOptionsFunctions;

export function normalizeBaseUrl(baseUrl: string): string {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

export function normalizeEndpoint(endpoint: string): string {
  const trimmed = String(endpoint || '').trim();
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function buildAlgaApiRequestOptions(
  credentials: AlgaPsaCredentials,
  method: IHttpRequestMethods,
  endpoint: string,
  query?: IDataObject,
  body?: IDataObject,
): IHttpRequestOptions {
  const baseUrl = normalizeBaseUrl(credentials.baseUrl);
  const path = normalizeEndpoint(endpoint);

  const qs = Object.entries(query ?? {}).reduce((acc, [key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      acc[key] = value;
    }
    return acc;
  }, {} as IDataObject);

  return {
    method,
    url: `${baseUrl}${path}`,
    headers: {
      'x-api-key': credentials.apiKey,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    ...(Object.keys(qs).length > 0 ? { qs } : {}),
    ...(body ? { body } : {}),
    json: true,
  };
}

export async function algaApiRequest(
  context: RequestFunctions,
  method: IHttpRequestMethods,
  endpoint: string,
  query?: IDataObject,
  body?: IDataObject,
): Promise<IDataObject | IDataObject[] | undefined> {
  const credentials = (await context.getCredentials('algaPsaApi')) as unknown as AlgaPsaCredentials;
  const options = buildAlgaApiRequestOptions(credentials, method, endpoint, query, body);

  return (await context.helpers.httpRequest(options)) as IDataObject | IDataObject[] | undefined;
}
