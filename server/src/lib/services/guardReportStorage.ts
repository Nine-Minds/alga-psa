/**
 * Guard Report Storage Service
 *
 * Handles uploading generated reports to S3 and generating signed download URLs.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream, existsSync, statSync } from 'fs';
import path from 'path';
import logger from '@shared/core/logger';
import type { GuardReportFormat } from '../../interfaces/guard/report.interfaces';

// MIME types for report formats
const MIME_TYPES: Record<GuardReportFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

// Default signed URL expiration (1 hour)
const DEFAULT_URL_EXPIRATION_SECONDS = 3600;

interface S3Config {
  endpoint?: string;
  region: string;
  bucket: string;
  forcePathStyle?: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
}

/**
 * Get S3 configuration from environment variables
 */
function getS3Config(): S3Config {
  // Use dedicated Guard report storage or fall back to general storage
  const bucket = process.env.GUARD_REPORT_BUCKET || process.env.STORAGE_S3_BUCKET || 'alga-guard-reports';
  const region = process.env.GUARD_REPORT_REGION || process.env.STORAGE_S3_REGION || 'us-east-1';
  const endpoint = process.env.GUARD_REPORT_ENDPOINT || process.env.STORAGE_S3_ENDPOINT;
  const forcePathStyle = String(process.env.GUARD_REPORT_FORCE_PATH_STYLE || process.env.STORAGE_S3_FORCE_PATH_STYLE || 'false') === 'true';
  const accessKeyId = process.env.GUARD_REPORT_ACCESS_KEY || process.env.STORAGE_S3_ACCESS_KEY;
  const secretAccessKey = process.env.GUARD_REPORT_SECRET_KEY || process.env.STORAGE_S3_SECRET_KEY;

  return {
    endpoint,
    region,
    bucket,
    forcePathStyle,
    accessKeyId,
    secretAccessKey,
  };
}

/**
 * Create S3 client
 */
function createS3Client(): { client: S3Client; bucket: string } {
  const config = getS3Config();

  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: config.accessKeyId && config.secretAccessKey
      ? {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        }
      : undefined,
  });

  return { client, bucket: config.bucket };
}

/**
 * Generate S3 key for a report
 */
function generateReportKey(tenant: string, reportId: string, format: GuardReportFormat, reportName: string): string {
  const sanitizedName = reportName.replace(/[^a-zA-Z0-9-_]/g, '_');
  const timestamp = Date.now();
  return `reports/${tenant}/${reportId}/${sanitizedName}_${timestamp}.${format}`;
}

/**
 * Upload a report file to S3
 */
export async function uploadReportToS3(
  tenant: string,
  reportId: string,
  localFilePath: string,
  format: GuardReportFormat,
  reportName: string
): Promise<{
  s3Key: string;
  s3Bucket: string;
  fileSize: number;
}> {
  const { client, bucket } = createS3Client();

  // Check if file exists
  if (!existsSync(localFilePath)) {
    throw new Error(`Local file not found: ${localFilePath}`);
  }

  const stats = statSync(localFilePath);
  const fileSize = stats.size;
  const s3Key = generateReportKey(tenant, reportId, format, reportName);
  const contentType = MIME_TYPES[format];

  logger.info('Uploading report to S3', {
    tenant,
    reportId,
    s3Key,
    bucket,
    fileSize,
  });

  try {
    const fileStream = createReadStream(localFilePath);

    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: fileStream,
      ContentType: contentType,
      ContentDisposition: `attachment; filename="${path.basename(localFilePath)}"`,
      Metadata: {
        'tenant': tenant,
        'report-id': reportId,
        'report-format': format,
      },
    }));

    logger.info('Report uploaded to S3 successfully', {
      tenant,
      reportId,
      s3Key,
    });

    return {
      s3Key,
      s3Bucket: bucket,
      fileSize,
    };
  } catch (error) {
    logger.error('Failed to upload report to S3', {
      tenant,
      reportId,
      s3Key,
      error,
    });
    throw error;
  }
}

/**
 * Generate a signed URL for downloading a report
 */
export async function generateSignedDownloadUrl(
  s3Key: string,
  expirationSeconds: number = DEFAULT_URL_EXPIRATION_SECONDS
): Promise<string> {
  const { client, bucket } = createS3Client();

  logger.info('Generating signed URL for report', {
    s3Key,
    bucket,
    expirationSeconds,
  });

  try {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: s3Key,
    });

    const signedUrl = await getSignedUrl(client, command, {
      expiresIn: expirationSeconds,
    });

    logger.info('Signed URL generated successfully', {
      s3Key,
    });

    return signedUrl;
  } catch (error) {
    logger.error('Failed to generate signed URL', {
      s3Key,
      error,
    });
    throw error;
  }
}

/**
 * Delete a report from S3
 */
export async function deleteReportFromS3(s3Key: string): Promise<void> {
  const { client, bucket } = createS3Client();

  logger.info('Deleting report from S3', {
    s3Key,
    bucket,
  });

  try {
    await client.send(new DeleteObjectCommand({
      Bucket: bucket,
      Key: s3Key,
    }));

    logger.info('Report deleted from S3 successfully', {
      s3Key,
    });
  } catch (error) {
    logger.error('Failed to delete report from S3', {
      s3Key,
      error,
    });
    throw error;
  }
}

/**
 * Check if S3 storage is configured
 */
export function isS3StorageConfigured(): boolean {
  const config = getS3Config();
  // S3 is considered configured if we have at least a bucket and credentials
  return !!(config.bucket && config.accessKeyId && config.secretAccessKey);
}

/**
 * Storage mode - determines if we should use S3 or local file storage
 */
export function getStorageMode(): 'local' | 's3' {
  // Use S3 if configured, otherwise fall back to local storage
  if (isS3StorageConfigured()) {
    return 's3';
  }
  return 'local';
}
