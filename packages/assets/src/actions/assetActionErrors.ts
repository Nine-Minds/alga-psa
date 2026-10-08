import {
  actionError,
  actionErrorFromValidationIssue,
  isAuthorizationThrow,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export const ASSET_CONTACT_UNAVAILABLE_MESSAGE = 'Selected contact is not available for this client';

export type AssetActionError = ActionMessageError | ActionPermissionError;

/** One field-level validation failure, as the form needs it to highlight an input. */
export type AssetValidationIssue = {
  path: Array<string | number>;
  code?: string;
  message: string;
};

/**
 * A returned (not thrown) validation failure: the first issue's localizable
 * action error plus the full issue list. `localizeActionError` spreads the
 * payload at the `withAuth` boundary, so `validationIssues` reaches the client
 * — unlike a thrown message, which Next.js masks in production builds
 * (alga0002283).
 */
export type AssetValidationError = { actionError: string; validationIssues: AssetValidationIssue[] };

export function assetValidationError(
  issues: ReadonlyArray<{
    code?: unknown;
    path?: ReadonlyArray<string | number>;
    message?: unknown;
    received?: unknown;
    params?: { messageKey?: unknown; messageParams?: unknown };
  }>,
): AssetActionError {
  return {
    // ActionMessageError is a nominal (never) type; the runtime value is a plain object.
    ...(actionErrorFromValidationIssue(issues[0]) as unknown as object),
    validationIssues: issues.map(({ path, code, message }) => ({
      path: [...(path ?? [])],
      ...(typeof code === 'string' ? { code } : {}),
      message: typeof message === 'string' && message ? message : 'Invalid value',
    })),
  } as unknown as AssetActionError;
}

export function isAssetValidationError(value: unknown): value is AssetValidationError {
  const candidate = value as { actionError?: unknown; validationIssues?: unknown } | null;
  return (
    !!candidate &&
    typeof candidate === 'object' &&
    typeof candidate.actionError === 'string' &&
    Array.isArray(candidate.validationIssues)
  );
}

export function assetActionErrorMessage(error: unknown): string {
  const candidate = error as { permissionError?: unknown; actionError?: unknown };
  return typeof candidate.permissionError === 'string' ? candidate.permissionError : String(candidate.actionError ?? 'Action failed');
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
    if (isAuthorizationThrow(error)) {
      return permissionError(message);
    }
    if (message === 'Asset not found') {
      return actionError('Asset not found. It may have been deleted. Please refresh and try again.', 'msp/assets:errors.asset.notFoundRefresh');
    }
    if (message === 'Client not found') {
      return actionError('Client not found. It may have been deleted. Please refresh and try again.', 'msp/assets:errors.asset.clientNotFound');
    }
    if (message === 'Maintenance schedule not found') {
      return actionError('Maintenance schedule not found. It may have been deleted. Please refresh and try again.', 'msp/assets:errors.asset.maintenanceNotFound');
    }
    if (message === 'Maintenance history schedule does not belong to the provided asset') {
      return actionError('This maintenance record does not match the selected asset. Please refresh and try again.', 'msp/assets:errors.asset.maintenanceMismatch');
    }
    if (message === 'Selected location is not available for this client') {
      return actionError('Selected location is not available for this client.', 'msp/assets:errors.asset.locationUnavailable');
    }
    if (message === ASSET_CONTACT_UNAVAILABLE_MESSAGE) {
      return actionError('Selected contact is not available for this client.', 'msp/assets:errors.asset.contactUnavailable');
    }
    if (message === 'An asset cannot be related to itself') {
      return actionError('An asset cannot be related to itself.', 'msp/assets:errors.asset.selfRelation');
    }
    if (message === 'Select at least one asset') {
      return actionError('Select at least one asset.', 'msp/assets:errors.asset.selectAtLeastOne');
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
          issues?: Array<{
            code?: unknown;
            path?: Array<string | number>;
            message?: string;
            received?: unknown;
            params?: { messageKey?: unknown; messageParams?: unknown };
          }>;
        };
        if (parsed.kind === 'invalid_asset_type') {
          const namedType = typeof parsed.asset_type === 'string' && parsed.asset_type.trim()
            ? parsed.asset_type
            : null;
          if (namedType) {
            return actionError(
              `Asset type "${namedType}" is not available. Choose a valid asset type.`,
              'msp/assets:errors.asset.typeUnavailableNamed',
              { assetType: namedType },
            );
          }
          return actionError(
            'Asset type is not available. Choose a valid asset type.',
            'msp/assets:errors.asset.typeUnavailable',
          );
        }
        if (parsed.kind === 'validation' && Array.isArray(parsed.issues)) {
          return parsed.issues.length > 0 ? assetValidationError(parsed.issues) : null;
        }
      } catch {
        // Not a structured validation message.
      }
    }
    if (message === 'Asset document association not found') {
      return actionError('Document association not found. It may have already been removed. Please refresh and try again.', 'msp/assets:errors.asset.documentAssociationNotFound');
    }
  }

  const validationIssues = (error as { issues?: unknown[] })?.issues;
  if (Array.isArray(validationIssues) && validationIssues.length > 0) {
    const firstIssue = validationIssues[0];
    return firstIssue && typeof firstIssue === 'object'
      ? actionErrorFromValidationIssue(firstIssue)
      : null;
  }

  const dbError = error as { code?: string; column?: string; constraint?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected asset values is invalid. Please refresh and try again.', 'msp/assets:errors.asset.invalidValue');
  }
  if (dbError?.code === '22007' || dbError?.code === '22008') {
    return actionError('One of the selected asset dates is invalid. Please review the form and try again.', 'msp/assets:errors.asset.invalidDate');
  }
  if (dbError?.code === '23502') {
    return dbError.column
      ? actionError(
          `Missing required asset field: ${dbError.column}.`,
          'msp/assets:errors.asset.missingFieldNamed',
          { field: dbError.column },
        )
      : actionError('Missing required asset field.', 'msp/assets:errors.asset.missingField');
  }
  if (dbError?.code === '23503') {
    return actionError('The selected asset, document, or related record no longer exists. Please refresh and try again.', 'msp/assets:errors.asset.referenceMissing');
  }
  if (dbError?.code === '23505') {
    return actionError('This asset change conflicts with an existing record. Please refresh and try again.', 'msp/assets:errors.asset.conflict');
  }
  if (dbError?.code === '23514') {
    return actionError('One of the asset values is not allowed. Please review the form and try again.', 'msp/assets:errors.asset.notAllowed');
  }

  return null;
}
