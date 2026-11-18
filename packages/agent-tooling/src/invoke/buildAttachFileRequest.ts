import { ATTACH_FILE_ENTITY_TYPES } from '../tools/definitions';
import type { BuiltRequest } from './buildRequest';

/**
 * Raised for bad `attach_file` arguments. The message is written for the model
 * to act on and NEVER contains a URL or base64 content: ChatGPT's `download_url`
 * is a signed credential.
 */
export class AttachFileInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttachFileInputError';
  }
}

const REATTACH_HINT = 'Ask the user to re-attach the file from ChatGPT web or desktop.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** Fail unless `value` is an https URL. Mentions at most the scheme. */
function assertHttps(value: string, label: string): void {
  const scheme = /^([a-z][a-z0-9+._-]*):/i.exec(value.trim())?.[1]?.toLowerCase();
  if (scheme === 'https') return;
  if (scheme === 'chat_upload') {
    throw new AttachFileInputError(
      `${label} uses the chat_upload:// scheme, which the server cannot download (this happens with mobile uploads). ${REATTACH_HINT}`,
    );
  }
  throw new AttachFileInputError(
    `${label} must be an https URL${scheme ? ` (got scheme "${scheme}")` : ''}. ${scheme ? '' : REATTACH_HINT}`.trim(),
  );
}

/**
 * Map `attach_file` tool arguments onto `POST /api/v1/documents`. Pure; the
 * caller adds auth and the base URL. Fails fast (AttachFileInputError) rather
 * than sending a request the server would reject.
 */
export function buildAttachFileRequest(rawArgs: Record<string, unknown> | undefined): BuiltRequest {
  const args = rawArgs ?? {};

  const entityType = args.entity_type;
  if (typeof entityType !== 'string' || !(ATTACH_FILE_ENTITY_TYPES as readonly string[]).includes(entityType)) {
    throw new AttachFileInputError(`entity_type is required and must be one of: ${ATTACH_FILE_ENTITY_TYPES.join(', ')}.`);
  }
  const entityId = nonEmptyString(args.entity_id);
  if (!entityId) {
    throw new AttachFileInputError('entity_id is required (the UUID of the record to attach the file to).');
  }

  const hasFile = args.file !== undefined && args.file !== null;
  const hasUrl = nonEmptyString(args.url) !== undefined;
  const hasBase64 = nonEmptyString(args.content_base64) !== undefined;
  const sources = [hasFile, hasUrl, hasBase64].filter(Boolean).length;
  if (sources === 0) {
    throw new AttachFileInputError(
      `Provide exactly one of file, url or content_base64. If the user attached a file and it did not arrive, ${REATTACH_HINT.toLowerCase()}`,
    );
  }
  if (sources > 1) {
    throw new AttachFileInputError('Provide exactly one of file, url or content_base64, not several.');
  }

  let source: { type: 'url'; url: string } | { type: 'base64'; content: string };
  let fileName = nonEmptyString(args.file_name);
  let mimeType = nonEmptyString(args.mime_type);

  if (hasFile) {
    const file = args.file;
    if (typeof file === 'string') {
      throw new AttachFileInputError(
        `file must be an object with a download_url, but a plain string was received. ${REATTACH_HINT}`,
      );
    }
    if (!isRecord(file)) {
      throw new AttachFileInputError(`file must be an object with a download_url. ${REATTACH_HINT}`);
    }
    const downloadUrl = nonEmptyString(file.download_url);
    if (!downloadUrl) {
      throw new AttachFileInputError(`file has no download_url. ${REATTACH_HINT}`);
    }
    assertHttps(downloadUrl, 'file.download_url');
    source = { type: 'url', url: downloadUrl };
    fileName = fileName ?? nonEmptyString(file.file_name);
    mimeType = mimeType ?? nonEmptyString(file.mime_type);
  } else if (hasUrl) {
    const url = args.url as string;
    assertHttps(url, 'url');
    source = { type: 'url', url };
  } else {
    if (!fileName) {
      throw new AttachFileInputError('file_name is required when using content_base64.');
    }
    source = { type: 'base64', content: args.content_base64 as string };
  }

  const body: Record<string, unknown> = {
    entity_type: entityType,
    entity_id: entityId,
    source,
    ...(fileName ? { file_name: fileName } : {}),
    ...(mimeType ? { mime_type: mimeType } : {}),
  };

  return {
    method: 'POST',
    path: '/api/v1/documents',
    query: {},
    headers: {},
    body: JSON.stringify(body),
    isMutation: true,
  };
}
