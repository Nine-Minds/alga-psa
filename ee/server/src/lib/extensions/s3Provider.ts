import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

export interface S3Config {
  endpoint: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  bucket: string;
}

export function makeS3FromEnv(): { client: S3Client; bucket: string } {
  const endpoint = process.env.STORAGE_S3_ENDPOINT as string;
  const region = process.env.STORAGE_S3_REGION || 'us-east-1';
  const accessKeyId = process.env.STORAGE_S3_ACCESS_KEY;
  const secretAccessKey = process.env.STORAGE_S3_SECRET_KEY;
  const forcePathStyle = String(process.env.STORAGE_S3_FORCE_PATH_STYLE || 'true') === 'true';
  const bucket = process.env.STORAGE_S3_BUCKET as string;
  if (!endpoint || !bucket) throw new Error('S3 storage not configured');
  const client = new S3Client({ endpoint, region, forcePathStyle, credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined });
  return { client, bucket };
}

export async function getObjectStream(key: string): Promise<NodeJS.ReadableStream> {
  const { client, bucket } = makeS3FromEnv();
  const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key.replace(/^\//, '') }));
  if (!out.Body || typeof (out.Body as any).pipe !== 'function') throw new Error('s3 body not stream');
  return out.Body as NodeJS.ReadableStream;
}

export async function verifyBundleSignature(_contentHash: string): Promise<boolean> {
  // TODO: implement signature verification using SIGNING_TRUST_BUNDLE
  return true;
}

export async function verifyBundleHash(_contentHash: string): Promise<boolean> {
  // TODO: stream and compute sha256, compare with contentHash
  return true;
}
