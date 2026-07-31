/*
 * Typed failures for the bucket-usage path.
 *
 * Bucket usage can fail for several unrelated reasons — no active contract line
 * covers the date, two assignments claim the service, the line's bucket detail
 * row is missing, the billing frequency is one the period maths cannot express.
 * These used to reach the user as a single sentence ("Unable to update bucket
 * usage for this time entry"), because the server-action guards matched on
 * substrings of a message that had already been flattened by an intermediate
 * rewrap. Diagnosing alga0002175 needed a production database session purely to
 * recover which of the four had happened.
 *
 * Carry the `code` instead. Server-action guards map code -> actionable
 * sentence; `details` stays out of the user's face and goes to the log.
 */

export type BucketUsageErrorCode =
    /** No active client contract line with a bucket covers the target date. */
    | 'NO_ACTIVE_CONTRACT_LINE'
    /** More than one active assignment claims this client/service pair. */
    | 'AMBIGUOUS_ASSIGNMENT'
    /** The contract line has no configuration row for this service. */
    | 'MISSING_PLAN_SERVICE_CONFIG'
    /** The Bucket configuration row exists but its detail row does not. */
    | 'MISSING_BUCKET_CONFIG'
    /** The line's billing frequency has no period calculation. */
    | 'UNSUPPORTED_BILLING_FREQUENCY';

export interface BucketUsageErrorDetails {
    tenant?: string;
    clientId?: string;
    contractLineId?: string;
    serviceCatalogId?: string;
    configId?: string;
    billingFrequency?: string;
    date?: string;
    [key: string]: unknown;
}

export class BucketUsageError extends Error {
    readonly code: BucketUsageErrorCode;
    readonly details: BucketUsageErrorDetails;

    constructor(
        code: BucketUsageErrorCode,
        message: string,
        details: BucketUsageErrorDetails = {},
        options?: { cause?: unknown },
    ) {
        super(message, options as ErrorOptions | undefined);
        this.name = 'BucketUsageError';
        this.code = code;
        this.details = details;

        // Preserve `instanceof` when this file is transpiled to ES5 targets.
        Object.setPrototypeOf(this, BucketUsageError.prototype);
    }
}

/**
 * User-facing text per failure code. Each one names what is wrong and what to
 * change; "please refresh and try again" is never the honest answer for these —
 * none of them resolve by retrying.
 *
 * Shared by the time-entry and usage-record action guards so a given failure
 * reads identically wherever the user meets it.
 */
export const BUCKET_USAGE_ERROR_MESSAGES: Record<BucketUsageErrorCode, string> = {
    NO_ACTIVE_CONTRACT_LINE:
        'No active contract covers this date for this client and service. Check the contract’s start date and that it is active.',
    AMBIGUOUS_ASSIGNMENT:
        'More than one active contract gives this client a bucket for this service. End-date or deactivate the duplicate, then try again.',
    MISSING_PLAN_SERVICE_CONFIG:
        'This contract line has no bucket configuration for this service. Re-save the bucket settings on the contract line.',
    MISSING_BUCKET_CONFIG:
        'This contract line’s bucket settings are incomplete. Re-save the bucket configuration on the contract line.',
    UNSUPPORTED_BILLING_FREQUENCY:
        'Bucket billing does not support this contract line’s billing frequency. Set the line to monthly, quarterly, or annually.',
};

export function bucketUsageErrorMessage(error: BucketUsageError): string {
    return (
        BUCKET_USAGE_ERROR_MESSAGES[error.code]
        // An unrecognised code is still better served by a generic sentence than
        // by leaking the internal message.
        ?? 'Unable to update bucket usage. Check the contract line’s bucket configuration.'
    );
}

export function isBucketUsageError(value: unknown): value is BucketUsageError {
    if (value instanceof BucketUsageError) {
        return true;
    }

    // Cross-realm / re-bundled copies of this class (the shared module is
    // consumed from several packages) fail `instanceof`, so fall back to shape.
    const candidate = value as { name?: unknown; code?: unknown } | null;
    return (
        typeof value === 'object' &&
        value !== null &&
        candidate?.name === 'BucketUsageError' &&
        typeof candidate?.code === 'string'
    );
}

/**
 * Recovers a BucketUsageError from an error that may have been wrapped with
 * `{ cause }` on its way up through the action layers.
 */
export function findBucketUsageError(value: unknown): BucketUsageError | null {
    let current: unknown = value;
    // Bounded so a self-referential cause chain cannot spin.
    for (let depth = 0; current != null && depth < 10; depth += 1) {
        if (isBucketUsageError(current)) {
            return current;
        }
        current = (current as { cause?: unknown }).cause;
    }
    return null;
}
