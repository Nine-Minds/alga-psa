import { ZodTypeAny } from 'zod';

export type ApiEdition = 'ce' | 'ee' | 'both';
export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options' | 'head';

export interface ApiRequestBodySpec {
  contentType?: string;
  description?: string;
  required?: boolean;
  schema: ZodTypeAny;
}

export interface ApiRequestSpec {
  params?: ZodTypeAny;
  query?: ZodTypeAny;
  headers?: ZodTypeAny;
  body?: ApiRequestBodySpec | ApiRequestBodySpec[];
}

export interface ApiResponseSpec {
  description: string;
  contentType?: string;
  schema?: ZodTypeAny;
  /**
   * Some responses do not return a payload (204, 304, etc.).
   * Setting `emptyBody` avoids emitting a schema.
   */
  emptyBody?: boolean;
}

export interface ApiRouteSpec {
  method: HttpMethod;
  path: string;
  summary: string;
  description?: string;
  tags?: string[];
  operationId?: string;
  deprecated?: boolean;
  security?: Array<Record<string, string[]>>;
  request?: ApiRequestSpec;
  responses: Record<string | number, ApiResponseSpec>;
  extensions?: Record<string, unknown>;
  edition?: ApiEdition;
}

export interface RegistryMetadata {
  title: string;
  version: string;
  description?: string;
  edition: Exclude<ApiEdition, 'both'>;
}

export interface DocumentBuildOptions extends RegistryMetadata {
  servers?: Array<{ url: string; description?: string }>;
  tags?: Array<{ name: string; description?: string }>;
}
