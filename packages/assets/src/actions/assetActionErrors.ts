import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export type AssetActionError = ActionMessageError | ActionPermissionError;

export function assetActionErrorMessage(error: AssetActionError): string {
  return 'permissionError' in error ? error.permissionError : error.actionError;
}

export function isAssetActionError(value: unknown): value is AssetActionError {
  return assetActionErrorFrom(value) !== null;
}

export function unwrapAssetActionResult<T>(value: T | AssetActionError): T {
  const expected = assetActionErrorFrom(value);
  if (expected) {
    throw new Error(assetActionErrorMessage(expected));
  }
  return value as T;
}

export function assetActionErrorFrom(error: unknown): AssetActionError | null {
  if (error && typeof error === 'object') {
    const candidate = error as { permissionError?: unknown; actionError?: unknown };
    if (typeof candidate.permissionError === 'string') {
      return permissionError(candidate.permissionError);
    }
    if (typeof candidate.actionError === 'string') {
      return actionError(candidate.actionError);
    }
  }

  if (error instanceof Error) {
    const message = error.message;
    if (message.includes('Permission denied') || message === 'user is not logged in') {
      return permissionError(message);
    }
    if (message === 'Asset not found') {
      return actionError('Asset not found. It may have been deleted. Please refresh and try again.');
    }
    if (message === 'Client not found') {
      return actionError('Client not found. It may have been deleted. Please refresh and try again.');
    }
    if (message === 'Maintenance schedule not found') {
      return actionError('Maintenance schedule not found. It may have been deleted. Please refresh and try again.');
    }
    if (message === 'Maintenance history schedule does not belong to the provided asset') {
      return actionError('This maintenance record does not match the selected asset. Please refresh and try again.');
    }
    if (message === 'Selected location is not available for this client') {
      return actionError('Selected location is not available for this client.');
    }
    if (message === 'An asset cannot be related to itself') {
      return actionError('An asset cannot be related to itself.');
    }
    if (message === 'Select at least one asset') {
      return actionError('Select at least one asset.');
    }
    if (message.startsWith('Bulk actions are limited to')) {
      return actionError(message);
    }
    if (message.startsWith('Invalid input data:')) {
      return actionError(message.replace(/^Invalid input data:\s*/, ''));
    }
    if (message === 'Invalid asset input data. Review required fields and try again.') {
      return actionError(message);
    }
    if (message.startsWith('Asset validation failed:')) {
      return actionError(message.replace(/^Asset validation failed:\s*/, ''));
    }
    if (message.startsWith('{')) {
      try {
        const parsed = JSON.parse(message) as {
          kind?: string;
          asset_type?: string;
          issues?: Array<{ path?: Array<string | number>; message?: string }>;
        };
        if (parsed.kind === 'invalid_asset_type') {
          const assetType = typeof parsed.asset_type === 'string' && parsed.asset_type.trim()
            ? ` "${parsed.asset_type}"`
            : '';
          return actionError(`Asset type${assetType} is not available. Choose a valid asset type.`);
        }
        if (parsed.kind === 'validation' && Array.isArray(parsed.issues)) {
          return actionError(parsed.issues
            .map((issue) => {
              const field = issue.path?.join('.');
              return field ? `${field}: ${issue.message || 'Invalid value'}` : issue.message || 'Invalid value';
            })
            .join('; '));
        }
      } catch {
        // Not a structured validation message.
      }
    }
    if (message === 'Asset document association not found') {
      return actionError('Document association not found. It may have already been removed. Please refresh and try again.');
    }
  }

  const validationIssues = (error as { issues?: Array<{ path?: Array<string | number>; message?: string }> })?.issues;
  if (Array.isArray(validationIssues) && validationIssues.length > 0) {
    return actionError(validationIssues
      .map((issue) => {
        const field = issue.path?.join('.');
        return field ? `${field}: ${issue.message || 'Invalid value'}` : issue.message || 'Invalid value';
      })
      .join('; '));
  }

  const dbError = error as { code?: string; column?: string; constraint?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected asset values is invalid. Please refresh and try again.');
  }
  if (dbError?.code === '22007' || dbError?.code === '22008') {
    return actionError('One of the selected asset dates is invalid. Please review the form and try again.');
  }
  if (dbError?.code === '23502') {
    return actionError(`Missing required asset field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('The selected asset, document, or related record no longer exists. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('This asset change conflicts with an existing record. Please refresh and try again.');
  }
  if (dbError?.code === '23514') {
    return actionError('One of the asset values is not allowed. Please review the form and try again.');
  }

  return null;
}
