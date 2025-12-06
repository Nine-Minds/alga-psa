/**
 * Desktop Agent Signature Verifier
 *
 * Verifies code signatures on update packages before installation.
 * Supports both Windows (Authenticode) and macOS (codesign) verification.
 */

import { createHash, createVerify } from 'crypto';
import { readFile, stat } from 'fs/promises';
import { spawn } from 'child_process';
import * as path from 'path';

/**
 * Verification result
 */
export interface VerificationResult {
  valid: boolean;
  sha256Match: boolean;
  signatureValid: boolean;
  signerName?: string;
  error?: string;
}

/**
 * Signature verification options
 */
export interface VerifyOptions {
  /** Expected SHA256 hash of the file */
  expectedSha256: string;
  /** Expected signature (base64 encoded) for RSA verification */
  signature?: string;
  /** Public key for RSA signature verification (PEM format) */
  publicKey?: string;
  /** Expected code signer name (for platform verification) */
  expectedSigner?: string;
  /** Skip platform-specific signature check */
  skipPlatformCheck?: boolean;
}

/**
 * Calculate SHA256 hash of a file
 */
export async function calculateSha256(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  const hash = createHash('sha256');
  hash.update(content);
  return hash.digest('hex');
}

/**
 * Verify file integrity using SHA256
 */
export async function verifySha256(
  filePath: string,
  expectedHash: string
): Promise<boolean> {
  const actualHash = await calculateSha256(filePath);
  return actualHash.toLowerCase() === expectedHash.toLowerCase();
}

/**
 * Verify RSA signature
 */
export function verifyRsaSignature(
  data: Buffer,
  signature: string,
  publicKey: string
): boolean {
  try {
    const verify = createVerify('RSA-SHA256');
    verify.update(data);
    return verify.verify(publicKey, signature, 'base64');
  } catch {
    return false;
  }
}

/**
 * Verify Windows Authenticode signature using PowerShell
 */
async function verifyWindowsSignature(filePath: string): Promise<{
  valid: boolean;
  signerName?: string;
  error?: string;
}> {
  return new Promise((resolve) => {
    // Use PowerShell to check Authenticode signature
    const ps = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `
        $sig = Get-AuthenticodeSignature -FilePath '${filePath}'
        if ($sig.Status -eq 'Valid') {
          Write-Output "VALID"
          Write-Output $sig.SignerCertificate.Subject
        } else {
          Write-Output "INVALID"
          Write-Output $sig.StatusMessage
        }
      `,
    ]);

    let stdout = '';
    let stderr = '';

    ps.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ps.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ps.on('close', (code) => {
      const lines = stdout.trim().split('\n').map(l => l.trim());

      if (lines[0] === 'VALID') {
        // Extract CN from subject
        const subject = lines[1] || '';
        const cnMatch = subject.match(/CN=([^,]+)/);
        const signerName = cnMatch ? cnMatch[1] : subject;

        resolve({
          valid: true,
          signerName,
        });
      } else {
        resolve({
          valid: false,
          error: lines[1] || stderr || 'Unknown signature verification error',
        });
      }
    });

    ps.on('error', (err) => {
      resolve({
        valid: false,
        error: `Failed to run PowerShell: ${err.message}`,
      });
    });
  });
}

/**
 * Verify macOS codesign signature
 */
async function verifyMacOSSignature(filePath: string): Promise<{
  valid: boolean;
  signerName?: string;
  error?: string;
}> {
  return new Promise((resolve) => {
    // First verify the signature
    const verify = spawn('codesign', ['--verify', '--deep', '--strict', filePath]);

    let verifyStderr = '';

    verify.stderr.on('data', (data) => {
      verifyStderr += data.toString();
    });

    verify.on('close', (verifyCode) => {
      if (verifyCode !== 0) {
        resolve({
          valid: false,
          error: verifyStderr || 'Code signature verification failed',
        });
        return;
      }

      // Get signer information
      const display = spawn('codesign', ['--display', '--verbose=2', filePath]);

      let displayStderr = '';

      display.stderr.on('data', (data) => {
        displayStderr += data.toString();
      });

      display.on('close', () => {
        // Parse Authority field from output
        const authorityMatch = displayStderr.match(/Authority=(.+)/);
        const signerName = authorityMatch ? authorityMatch[1].trim() : undefined;

        resolve({
          valid: true,
          signerName,
        });
      });

      display.on('error', () => {
        // Signature is valid even if we can't get signer info
        resolve({
          valid: true,
        });
      });
    });

    verify.on('error', (err) => {
      resolve({
        valid: false,
        error: `Failed to run codesign: ${err.message}`,
      });
    });
  });
}

/**
 * Verify platform-specific code signature
 */
export async function verifyPlatformSignature(filePath: string): Promise<{
  valid: boolean;
  signerName?: string;
  error?: string;
}> {
  const platform = process.platform;

  if (platform === 'win32') {
    return verifyWindowsSignature(filePath);
  } else if (platform === 'darwin') {
    return verifyMacOSSignature(filePath);
  }

  return {
    valid: false,
    error: `Unsupported platform: ${platform}`,
  };
}

/**
 * Comprehensive update package verification
 */
export async function verifyUpdatePackage(
  filePath: string,
  options: VerifyOptions
): Promise<VerificationResult> {
  const result: VerificationResult = {
    valid: false,
    sha256Match: false,
    signatureValid: false,
  };

  try {
    // Check file exists
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      result.error = 'Not a file';
      return result;
    }

    // Verify SHA256 hash
    result.sha256Match = await verifySha256(filePath, options.expectedSha256);
    if (!result.sha256Match) {
      result.error = 'SHA256 hash mismatch';
      return result;
    }

    // If RSA signature provided, verify it
    if (options.signature && options.publicKey) {
      const fileContent = await readFile(filePath);
      result.signatureValid = verifyRsaSignature(
        fileContent,
        options.signature,
        options.publicKey
      );

      if (!result.signatureValid) {
        result.error = 'RSA signature verification failed';
        return result;
      }
    } else {
      // No RSA signature to verify
      result.signatureValid = true;
    }

    // Platform-specific signature verification
    if (!options.skipPlatformCheck) {
      const platformResult = await verifyPlatformSignature(filePath);

      if (!platformResult.valid) {
        result.error = platformResult.error || 'Platform signature verification failed';
        return result;
      }

      result.signerName = platformResult.signerName;

      // Verify expected signer if specified
      if (options.expectedSigner && platformResult.signerName) {
        if (!platformResult.signerName.includes(options.expectedSigner)) {
          result.error = `Unexpected signer: ${platformResult.signerName}`;
          return result;
        }
      }
    }

    // All checks passed
    result.valid = true;
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  }
}

/**
 * Quick hash-only verification (for progress/pre-checks)
 */
export async function quickVerify(
  filePath: string,
  expectedSha256: string
): Promise<boolean> {
  try {
    return await verifySha256(filePath, expectedSha256);
  } catch {
    return false;
  }
}
