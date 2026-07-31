export const SCIM_MEDIA_TYPE = 'application/scim+json';
export const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const SCIM_LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
export const SCIM_PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

export class ScimError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly scimType?: string
  ) {
    super(message);
    this.name = 'ScimError';
  }
}

export interface ScimEmail {
  value: string;
  type?: string;
  primary?: boolean;
}

export interface ScimUserInput {
  schemas?: unknown;
  externalId?: unknown;
  userName?: unknown;
  active?: unknown;
  displayName?: unknown;
  title?: unknown;
  name?: {
    givenName?: unknown;
    familyName?: unknown;
  } | unknown;
  emails?: unknown;
}

export interface NormalizedScimUser {
  externalId: string;
  userName: string;
  active: boolean;
  primaryEmail: string | null;
  displayName: string | null;
  givenName: string | null;
  familyName: string | null;
  title: string | null;
}

export interface ScimFilter {
  attribute: 'userName' | 'externalId';
  value: string;
}

function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new ScimError(400, `${field} must be a string.`, 'invalidValue');
  }
  const normalized = value.trim();
  return normalized || null;
}

function parseSchemas(value: unknown, requiredSchema: string): void {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new ScimError(400, 'schemas must be an array of schema URNs.', 'invalidSyntax');
  }
  if (!value.includes(requiredSchema)) {
    throw new ScimError(400, `The ${requiredSchema} schema is required.`, 'invalidValue');
  }
}

function parsePrimaryEmail(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) {
    throw new ScimError(400, 'emails must be an array.', 'invalidValue');
  }

  const emails = value.map((entry): ScimEmail => {
    if (!entry || typeof entry !== 'object' || typeof (entry as ScimEmail).value !== 'string') {
      throw new ScimError(400, 'Each email must contain a string value.', 'invalidValue');
    }
    return entry as ScimEmail;
  });

  const primary = emails.find((email) => email.primary === true);
  return optionalString(primary?.value, 'emails.value');
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function parseScimUser(
  value: unknown,
  options: { requireSchemas?: boolean; requireExternalId?: boolean } = {}
): NormalizedScimUser {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ScimError(400, 'The request body must be a SCIM User object.', 'invalidSyntax');
  }

  const input = value as ScimUserInput;
  if (options.requireSchemas !== false) {
    parseSchemas(input.schemas, SCIM_USER_SCHEMA);
  }

  const externalId = optionalString(input.externalId, 'externalId');
  if (options.requireExternalId !== false && !externalId) {
    throw new ScimError(400, 'externalId is required.', 'invalidValue');
  }

  const userName = optionalString(input.userName, 'userName');
  if (!userName) {
    throw new ScimError(400, 'userName is required.', 'invalidValue');
  }

  if (input.active !== undefined && typeof input.active !== 'boolean') {
    throw new ScimError(400, 'active must be a boolean.', 'invalidValue');
  }

  const name = input.name;
  if (name !== undefined && (!name || typeof name !== 'object' || Array.isArray(name))) {
    throw new ScimError(400, 'name must be an object.', 'invalidValue');
  }
  const structuredName = (name ?? {}) as Record<string, unknown>;

  return {
    externalId: externalId ?? '',
    userName,
    active: input.active !== false,
    primaryEmail: parsePrimaryEmail(input.emails),
    displayName: optionalString(input.displayName, 'displayName'),
    givenName: optionalString(structuredName.givenName, 'name.givenName'),
    familyName: optionalString(structuredName.familyName, 'name.familyName'),
    title: optionalString(input.title, 'title'),
  };
}

export function parseScimFilter(value: string | null): ScimFilter | null {
  if (!value) return null;

  const match = value.match(/^(userName|externalId)\s+eq\s+"((?:[^"\\]|\\.)*)"$/i);
  if (!match) {
    throw new ScimError(400, 'Only exact userName and externalId filters are supported.', 'invalidFilter');
  }

  let decoded: string;
  try {
    decoded = JSON.parse(`"${match[2]}"`);
  } catch {
    throw new ScimError(400, 'The SCIM filter contains an invalid string value.', 'invalidFilter');
  }

  return {
    attribute: match[1].toLowerCase() === 'username' ? 'userName' : 'externalId',
    value: decoded,
  };
}

export interface ScimPatchOperation {
  op: 'add' | 'replace' | 'remove';
  path?: string;
  value?: unknown;
}

export function parsePatchOperations(value: unknown): ScimPatchOperation[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ScimError(400, 'The request body must be a SCIM PatchOp object.', 'invalidSyntax');
  }
  const body = value as { schemas?: unknown; Operations?: unknown };
  parseSchemas(body.schemas, SCIM_PATCH_SCHEMA);
  if (!Array.isArray(body.Operations) || body.Operations.length === 0) {
    throw new ScimError(400, 'PATCH requires at least one operation.', 'invalidValue');
  }

  return body.Operations.map((entry): ScimPatchOperation => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ScimError(400, 'Each PATCH operation must be an object.', 'invalidValue');
    }
    const operation = entry as { op?: unknown; path?: unknown; value?: unknown };
    if (typeof operation.op !== 'string') {
      throw new ScimError(400, 'Each PATCH operation requires op.', 'invalidValue');
    }
    const op = operation.op.toLowerCase();
    if (op !== 'add' && op !== 'replace' && op !== 'remove') {
      throw new ScimError(400, `Unsupported PATCH operation ${operation.op}.`, 'invalidValue');
    }
    const path = operation.path;
    if (path !== undefined && typeof path !== 'string') {
      throw new ScimError(400, 'PATCH path must be a string.', 'invalidPath');
    }
    return {
      op,
      path: typeof path === 'string' ? path.trim() : undefined,
      value: operation.value,
    };
  });
}

export function scimJson(
  body: unknown,
  status = 200,
  headers?: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': SCIM_MEDIA_TYPE,
      ...headers,
    },
  });
}

export function scimErrorResponse(error: unknown): Response {
  const scimError = error instanceof ScimError
    ? error
    : new ScimError(500, 'The SCIM request could not be completed.');

  return scimJson({
    schemas: [SCIM_ERROR_SCHEMA],
    status: String(scimError.status),
    ...(scimError.scimType ? { scimType: scimError.scimType } : {}),
    detail: scimError.message,
  }, scimError.status);
}
