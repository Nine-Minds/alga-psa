export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface ChatApiParameter {
  name: string;
  in: 'query' | 'path' | 'header';
  required: boolean;
  description?: string;
  schema?: unknown;
}

export interface ChatApiExample {
  name: string;
  description?: string;
  request?: {
    params?: Record<string, unknown>;
    query?: Record<string, unknown>;
    headers?: Record<string, unknown>;
    body?: unknown;
  };
  notes?: string;
}

export interface ChatApiRegistryEntry {
  id: string;
  method: HttpMethod;
  path: string;
  displayName: string;
  summary?: string;
  description?: string;
  tags: string[];
  rbacResource?: string;
  approvalRequired: boolean;
  requestExample?: unknown;
  requestBodySchema?: unknown;
  responseBodySchema?: unknown;
  parameters: ChatApiParameter[];
  playbooks?: string[];
  examples?: ChatApiExample[];
}

export interface ChatRegistryOverrideEntry {
  match: {
    id?: string;
    method?: HttpMethod;
    path?: string;
  };
  metadata: Partial<
    Pick<
      ChatApiRegistryEntry,
      | 'displayName'
      | 'summary'
      | 'description'
      | 'rbacResource'
      | 'approvalRequired'
      | 'playbooks'
      | 'examples'
    >
  > & {
    requestBodySchema?: unknown;
    responseBodySchema?: unknown;
    parameters?: ChatApiParameter[];
  };
}

export interface ChatRegistryOverrideFile {
  entries: ChatRegistryOverrideEntry[];
}
