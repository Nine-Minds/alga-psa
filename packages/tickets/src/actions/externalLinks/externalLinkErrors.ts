import {
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { ExternalLinkValidationError, type ExternalLinkErrorCode } from './externalLinkPersistence';

export type ExternalLinkActionError = ActionMessageError | ActionPermissionError;

const CODE_MESSAGES: Record<ExternalLinkErrorCode, { message: string; key: string }> = {
  ticket_not_found: {
    message: 'Ticket not found',
    key: 'features/tickets:externalLinks.errors.ticketNotFound',
  },
  comment_not_found: {
    message: 'Comment not found on this ticket',
    key: 'features/tickets:externalLinks.errors.commentNotFound',
  },
  link_not_found: {
    message: 'External link not found',
    key: 'features/tickets:externalLinks.errors.linkNotFound',
  },
  system_not_found: {
    message: 'Unknown external system',
    key: 'features/tickets:externalLinks.errors.systemNotFound',
  },
  external_id_required: {
    message: 'External ID is required',
    key: 'features/tickets:externalLinks.errors.externalIdRequired',
  },
  invalid_url: {
    message: 'URL must be a valid http(s) URL',
    key: 'features/tickets:externalLinks.errors.invalidUrl',
  },
  url_required: {
    message: 'A clickable URL is required: provide an explicit URL or the fields the external system template needs',
    key: 'features/tickets:externalLinks.errors.urlRequired',
  },
  invalid_relationship: {
    message: 'Invalid relationship',
    key: 'features/tickets:externalLinks.errors.invalidRelationship',
  },
  invalid_entity_type: {
    message: 'Invalid entity type',
    key: 'features/tickets:externalLinks.errors.invalidEntityType',
  },
  origin_exists: {
    message: 'This entity already has an origin link',
    key: 'features/tickets:externalLinks.errors.originExists',
  },
  duplicate_external_link: {
    message: 'That external record is already linked',
    key: 'features/tickets:externalLinks.errors.duplicateExternalLink',
  },
  system_in_use: {
    message: 'This external system is used by existing links',
    key: 'features/tickets:externalLinks.errors.systemInUse',
  },
  invalid_system_key: {
    message: 'Custom system keys must match custom:<slug> with lowercase letters, digits, or underscores',
    key: 'features/tickets:externalLinks.errors.invalidSystemKey',
  },
  system_label_required: {
    message: 'System label is required',
    key: 'features/tickets:externalLinks.errors.systemLabelRequired',
  },
};

export function externalLinkActionError(
  code: ExternalLinkErrorCode,
  overrides?: { messageKey?: string; messageParams?: Record<string, unknown> },
): ExternalLinkActionError {
  const entry = CODE_MESSAGES[code];
  return {
    actionError: entry.message,
    messageKey: overrides?.messageKey ?? entry.key,
    ...(overrides?.messageParams ? { messageParams: overrides.messageParams } : {}),
    // Extra field for callers that want the machine code; ignored by bridges that
    // only read actionError/messageKey.
    code,
  } as unknown as ExternalLinkActionError;
}

export function externalLinkActionErrorFrom(error: unknown): ExternalLinkActionError | null {
  if (error instanceof ExternalLinkValidationError) {
    return externalLinkActionError(error.code);
  }

  if (error instanceof Error && error.message.includes('Permission denied')) {
    return permissionError(error.message, 'features/tickets:externalLinks.errors.permissionDenied');
  }

  return null;
}
