import { createHash } from "crypto";

/**
 * Options for hashing helpers.
 */
export interface HashOptions {
  /**
   * Maximum number of bytes allowed to be processed.
   * If exceeded, hashing will abort with an error.
   */
  maxBytes?: number;
}

/**
 * Result for SHA-256 hashing operations.
 */
export interface HashResult {
  algorithm: "sha256";
  /**
   * Lowercase hexadecimal digest.
   */
  hashHex: string;
  /**
   * Total number of bytes processed to compute the hash.
   */
  bytesProcessed: number;
}

/**
 * Supported signature algorithms for bundle verification.
 */
export type SignatureAlgorithm = "cosign" | "x509" | "pgp";

/**
 * Input for signature verification.
 * Note: This milestone implements a policy-aware stub. No cryptographic verification yet.
 */
export interface VerifySignatureInput {
  /**
   * Raw bundle content (optional when stream is used upstream and only signature policy check is required).
   */
  bundleBytes?: Buffer;
  /**
   * Detached signature bytes (if the algorithm uses a detached signature).
   */
  signatureBytes?: Buffer;
  /**
   * Inline signature text (e.g., ASCII-armored PGP or Cosign bundle JSON).
   */
  signatureText?: string;
  /**
   * Trust bundle material (e.g., root certs / keys) used to verify signatures.
   * If provided, signature is required by policy in this milestone.
   */
  trustBundle?: string;
  /**
   * Which signature algorithm should be used.
   */
  algorithm?: SignatureAlgorithm;
}

/**
 * Result of signature verification, suitable for downstream policy handling.
 */
export interface SignatureVerificationResult {
  /**
   * Whether a signature is required by current policy.
   */
  required: boolean;
  /**
   * Whether the provided signature was verified.
   * If required is false, verified may be false but still allowed by policy.
   */
  verified: boolean;
  /**
   * Which signature algorithm was used (if any).
   */
  algorithm?: SignatureAlgorithm;
  /**
   * Human-readable reason describing result or stub behavior.
   */
  reason?: string;
  /**
   * Subject identity extracted from signature (if available).
   */
  subject?: string;
  /**
   * Issuer identity extracted from signature (if available).
   */
  issuer?: string;
  /**
   * Timestamp associated with signature (RFC3339 string if available).
   */
  timestamp?: string;
}

/**
 * Composite input to verify an extension bundle.
 */
export interface VerifyBundleInput {
  /**
   * Readable stream for the bundle when streaming.
   */
  readable?: NodeJS.ReadableStream;
  /**
   * In-memory bundle buffer for small payloads.
   */
  buffer?: Buffer;
  /**
   * Maximum allowed bytes to process while hashing.
   */
  maxBytes?: number;
  /**
   * Optional signature information.
   */
  signature?: {
    bytes?: Buffer;
    text?: string;
    algorithm?: SignatureAlgorithm;
  };
  /**
   * Environment inputs. This utility does not directly read from process.env.
   */
  env: {
    SIGNING_TRUST_BUNDLE?: string;
  };
}

/**
 * Composite result for bundle verification.
 */
export interface VerifyBundleResult {
  hash: HashResult;
  signature: SignatureVerificationResult;
}

/**
 * Compute SHA-256 for a stream with optional max byte enforcement.
 *
 * - Uses Node's crypto module to stream data into a SHA-256 hash.
 * - If opts.maxBytes is provided and the stream exceeds this limit,
 *   the operation fails with: "Bundle size exceeds maximum allowed".
 *
 * @param readable NodeJS.ReadableStream to hash
 * @param opts HashOptions including optional maxBytes
 * @returns Promise resolving to HashResult
 */
export async function hashSha256Stream(
  readable: NodeJS.ReadableStream,
  opts?: HashOptions
): Promise<HashResult> {
  const maxBytes = opts?.maxBytes;
  const hash = createHash("sha256");
  let processed = 0;

  return new Promise<HashResult>((resolve, reject) => {
    const onData = (chunk: any) => {
      // Ensure chunk is a Buffer for byte length accounting
      const buf: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      processed += buf.length;

      if (typeof maxBytes === "number" && maxBytes >= 0 && processed > maxBytes) {
        cleanup();
        // Best-effort to stop the upstream producer
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (readable as any).destroy?.(new Error("Bundle size exceeds maximum allowed"));
        } catch {
          // ignore destroy errors
        }
        return reject(new Error("Bundle size exceeds maximum allowed"));
      }

      hash.update(buf);
    };

    const onEnd = () => {
      try {
        const digest = hash.digest("hex").toLowerCase();
        cleanup();
        resolve({
          algorithm: "sha256",
          hashHex: digest,
          bytesProcessed: processed,
        });
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      readable.removeListener("data", onData);
      readable.removeListener("end", onEnd);
      readable.removeListener("error", onError);
      // Some streams require 'pause' to stop flowing after handlers removed
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readable as any).pause?.();
    };

    readable.on("data", onData);
    readable.once("end", onEnd);
    readable.once("error", onError);
  });
}

/**
 * Compute SHA-256 for an in-memory Buffer with optional max byte enforcement.
 *
 * - Uses Node's crypto module to compute hash.
 * - If opts.maxBytes is provided and buffer length exceeds this limit,
 *   the operation fails with: "Bundle size exceeds maximum allowed".
 *
 * @param buffer Buffer with the bundle bytes
 * @param opts HashOptions including optional maxBytes
 * @returns Promise resolving to HashResult
 */
export async function hashSha256Buffer(
  buffer: Buffer,
  opts?: HashOptions
): Promise<HashResult> {
  const maxBytes = opts?.maxBytes;
  if (typeof maxBytes === "number" && maxBytes >= 0 && buffer.length > maxBytes) {
    throw new Error("Bundle size exceeds maximum allowed");
  }

  const hash = createHash("sha256");
  hash.update(buffer);
  const digest = hash.digest("hex").toLowerCase();

  return {
    algorithm: "sha256",
    hashHex: digest,
    bytesProcessed: buffer.length,
  };
}

/**
 * Determine trust bundle material from provided environment.
 *
 * This utility does not read process.env directly to avoid side effects.
 *
 * @param env Object containing SIGNING_TRUST_BUNDLE
 * @returns Trust bundle string if configured, otherwise undefined
 */
export function loadTrustBundle(env: { SIGNING_TRUST_BUNDLE?: string }): string | undefined {
  const tb = env.SIGNING_TRUST_BUNDLE;
  if (!tb) return undefined;
  const trimmed = tb.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Policy-aware signature verification stub.
 *
 * Behavior for this milestone:
 * - If input.trustBundle is provided:
 *   - Mark required = true.
 *   - If no signature bytes/text provided: return verified=false with reason "missing signature".
 *   - If signature is present: return verified=true with reason "stub acceptance" and echo algorithm.
 * - If no trustBundle is provided:
 *   - Return required=false, verified=false with reason "trust bundle not configured".
 *
 * TODO: Integrate real verification for:
 *   - cosign: Verify against Fulcio/CTFE roots or provided trust bundle
 *   - x509: Verify chain and leaf against trust bundle
 *   - pgp: Verify signature with keys in trust bundle
 *
 * @param input VerifySignatureInput
 * @returns SignatureVerificationResult
 */
export async function verifySignature(
  input: VerifySignatureInput
): Promise<SignatureVerificationResult> {
  const hasTrust = !!input.trustBundle;
  const hasSignature = !!(input.signatureBytes?.length || (input.signatureText && input.signatureText.length > 0));

  if (hasTrust) {
    if (!hasSignature) {
      return {
        required: true,
        verified: false,
        algorithm: input.algorithm,
        reason: "missing signature",
      };
    }
    return {
      required: true,
      verified: true,
      algorithm: input.algorithm,
      reason: "stub acceptance",
      subject: "unknown",
      issuer: "unknown",
      timestamp: new Date().toISOString(),
    };
  }

  return {
    required: false,
    verified: false,
    algorithm: input.algorithm,
    reason: "trust bundle not configured",
  };
}

/**
 * Verify an extension bundle:
 * - Hash using SHA-256 (stream or buffer) with optional max byte enforcement.
 * - Determine signature policy via loadTrustBundle(env).
 * - Perform policy-aware signature verification stub.
 *
 * @param input VerifyBundleInput
 * @returns VerifyBundleResult with hash and signature verification outcome
 */
export async function verifyBundle(input: VerifyBundleInput): Promise<VerifyBundleResult> {
  if (!input.readable && !input.buffer) {
    throw new Error("Either 'readable' or 'buffer' must be provided");
  }
  if (input.readable && input.buffer) {
    // Not strictly required, but prevent accidental double sources.
    throw new Error("Provide only one of 'readable' or 'buffer'");
  }

  const trustBundle = loadTrustBundle(input.env);

  // Hash selection
  const hash = input.readable
    ? await hashSha256Stream(input.readable, { maxBytes: input.maxBytes })
    : await hashSha256Buffer(input.buffer as Buffer, { maxBytes: input.maxBytes });

  // Prepare signature input for the stub
  const sigInput: VerifySignatureInput = {
    bundleBytes: input.buffer, // When streaming, this might be undefined; stub does not require it.
    signatureBytes: input.signature?.bytes,
    signatureText: input.signature?.text,
    algorithm: input.signature?.algorithm,
    trustBundle,
  };

  const signature = await verifySignature(sigInput);

  return { hash, signature };
}