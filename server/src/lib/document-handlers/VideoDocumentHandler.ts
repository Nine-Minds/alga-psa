import { IDocument, PreviewResponse } from 'server/src/interfaces/document.interface';
import { BaseDocumentHandler } from './BaseDocumentHandler';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { StorageProviderFactory } from 'server/src/lib/storage/StorageProviderFactory';
import type { Knex } from 'knex';
import { existsSync } from 'fs';
import { createRequire } from 'module';
import process from 'process';
import { Buffer } from 'buffer';
import { Readable } from 'stream';

const moduleRequire = createRequire(import.meta.url);

function resolveFfmpegPath(): string | null {
  const candidateFromEnv = process.env.FFMPEG_PATH;
  if (candidateFromEnv && existsSync(candidateFromEnv)) {
    return candidateFromEnv;
  }

  if (typeof ffmpegStatic === 'string' && existsSync(ffmpegStatic)) {
    return ffmpegStatic;
  }

  try {
    const modulePath = moduleRequire.resolve('ffmpeg-static');
    const derivedPath = path.join(path.dirname(modulePath), 'ffmpeg');
    const candidates = [derivedPath];

    if (derivedPath.startsWith('/ROOT')) {
      const adjustedPath = path.join(process.cwd(), derivedPath.replace('/ROOT', '').replace(/^\//, ''));
      candidates.push(adjustedPath);
    }

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  } catch (error) {
    console.warn('[VideoDocumentHandler] Unable to resolve ffmpeg-static module path', error);
  }

  const projectNodeModulesCandidate = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg');
  if (existsSync(projectNodeModulesCandidate)) {
    return projectNodeModulesCandidate;
  }

  const fallbacks = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
  for (const fallback of fallbacks) {
    if (existsSync(fallback)) {
      return fallback;
    }
  }

  return null;
}

function resolveFfprobePath(): string | null {
  const candidateFromEnv = process.env.FFPROBE_PATH;
  if (candidateFromEnv && existsSync(candidateFromEnv)) {
    return candidateFromEnv;
  }

  let ffprobeStaticModule: any = null;
  try {
    ffprobeStaticModule = moduleRequire('ffprobe-static');
  } catch (error) {
    console.warn('[VideoDocumentHandler] Unable to require ffprobe-static module', error);
  }

  const staticCandidates: Array<string | undefined> = [];
  if (ffprobeStaticModule) {
    if (typeof ffprobeStaticModule === 'string') {
      staticCandidates.push(ffprobeStaticModule);
    }

    const moduleWithPath = ffprobeStaticModule?.path ?? ffprobeStaticModule?.default?.path;
    if (typeof moduleWithPath === 'string') {
      staticCandidates.push(moduleWithPath);
    }
  }

  for (const candidate of staticCandidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
    if (candidate) {
      console.warn(`[VideoDocumentHandler] ffprobe candidate missing: ${candidate}`);
    }
  }

  try {
    const packagePath = moduleRequire.resolve('ffprobe-static/package.json');
    const binRoot = path.join(path.dirname(packagePath), 'bin');
    const binaryName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
    const derivedPath = path.join(binRoot, process.platform, process.arch, binaryName);
    const candidates = [derivedPath];

    if (derivedPath.startsWith('/ROOT')) {
      const adjustedPath = path.join(process.cwd(), derivedPath.replace('/ROOT', '').replace(/^\//, ''));
      candidates.push(adjustedPath);
    }

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
      console.warn(`[VideoDocumentHandler] ffprobe candidate missing: ${candidate}`);
    }
  } catch (error) {
    console.warn('[VideoDocumentHandler] Unable to resolve ffprobe-static module path', error);
  }

  const projectCandidate = path.join(
    process.cwd(),
    'node_modules',
    'ffprobe-static',
    'bin',
    process.platform,
    process.arch,
    process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  );
  if (existsSync(projectCandidate)) {
    return projectCandidate;
  }
  console.warn(`[VideoDocumentHandler] ffprobe candidate missing: ${projectCandidate}`);

  const fallbacks = ['/usr/bin/ffprobe', '/usr/local/bin/ffprobe'];
  for (const fallback of fallbacks) {
    if (existsSync(fallback)) {
      return fallback;
    }
    console.warn(`[VideoDocumentHandler] ffprobe candidate missing: ${fallback}`);
  }

  return null;
}

const ffmpegExecutable = resolveFfmpegPath();
const ffprobeExecutable = resolveFfprobePath();

if (ffmpegExecutable) {
  ffmpeg.setFfmpegPath(ffmpegExecutable);
  console.log(`[VideoDocumentHandler] Using ffmpeg executable at ${ffmpegExecutable}`);
} else {
  console.warn('[VideoDocumentHandler] ffmpeg executable not found; video thumbnails disabled');
}

if (ffprobeExecutable) {
  ffmpeg.setFfprobePath(ffprobeExecutable);
  console.log(`[VideoDocumentHandler] Using ffprobe executable at ${ffprobeExecutable}`);
} else {
  console.warn('[VideoDocumentHandler] ffprobe executable not found; some video thumbnails may fail');
}

/**
 * Handler for video file types
 * Provides basic information without generating image previews
 */
export class VideoDocumentHandler extends BaseDocumentHandler {
  /**
   * Determines if this handler can process the given document
   * @param document The document to check
   * @returns True if this handler can process the document, false otherwise
   */
  canHandle(document: IDocument): boolean {
    // Handle documents with video MIME types
    if (document.mime_type?.startsWith('video/')) {
      return true;
    }
    
    // Also handle based on file extension
    const extension = this.getFileExtension(document.document_name || '');
    const videoExtensions = ['mp4', 'avi', 'mov', 'wmv', 'mkv', 'webm', 'ogg', 'm4v', '3gp', 'flv'];
    return videoExtensions.includes(extension.toLowerCase());
  }

  /**
   * Generates a preview for the video document
   * @param document The document to generate a preview for
   * @param tenant The tenant ID
   * @param knex The Knex instance
   * @returns A promise that resolves to a PreviewResponse
   */
  async generatePreview(document: IDocument, tenant: string, knex: any): Promise<PreviewResponse> {
    try {
      console.log(`[VideoDocumentHandler] generatePreview called for ${document.document_name} (${document.file_id})`);

      if (!document.file_id) {
        return {
          success: false,
          error: 'No file ID found for document'
        };
      }

      // Check cache first
      const cachedPreview = await this.getFromCache(document.file_id, tenant);
      if (cachedPreview) {
        console.log(`[VideoDocumentHandler] Using cached preview for ${document.file_id}`);
        return cachedPreview;
      }

      console.log(`[VideoDocumentHandler] Generating thumbnail for ${document.file_id}`);
      const thumbnailBuffer = await this.generateThumbnail(document, tenant, knex);

      // For videos, we don't generate a preview image
      // Instead, we return success without a preview image
      // The client-side video component will handle the preview
      const fileName = document.document_name || 'Unknown';
      const fileSize = document.file_size ? Math.round(Number(document.file_size) / 1024) + ' KB' : 'Unknown size';
      const mimeType = document.mime_type || 'Unknown';
      
      const content = `Video File: ${fileName} (${fileSize})`;

      if (thumbnailBuffer) {
        console.log(`[VideoDocumentHandler] Generated thumbnail for ${document.file_id}, size=${thumbnailBuffer.length}`);
        const base64Image = `data:image/jpeg;base64,${thumbnailBuffer.toString('base64')}`;
        await this.saveToCache(document.file_id, thumbnailBuffer, tenant);
        return {
          success: true,
          previewImage: base64Image,
          content
        };
      }
      
      const result = { 
        success: true, 
        content: content,
        // No previewImage - let the client handle video preview
      };
      
      // Cache the result (without image data)
      await this.saveToCache(document.file_id, Buffer.from(JSON.stringify(result)), tenant);
      
      return result;
    } catch (error) {
      console.error(`[VideoDocumentHandler] Error generating preview for document ${document.document_id}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate video preview'
      };
    }
  }

  /**
   * Generates HTML content for the video document
   * @param document The document to generate HTML for
   * @param tenant The tenant ID
   * @param knex The Knex instance
   * @returns A promise that resolves to an HTML string
   */
  async generateHTML(document: IDocument, tenant: string, knex: any): Promise<string> {
    try {
      const fileName = document.document_name || 'Unknown';
      const fileSize = document.file_size ? Math.round(Number(document.file_size) / 1024) + ' KB' : 'Unknown size';
      const mimeType = document.mime_type || 'Unknown';
      
      return `
        <div class="video-document-info">
          <h3>🎬 Video File</h3>
          <p><strong>Filename:</strong> ${fileName}</p>
          <p><strong>Type:</strong> ${mimeType}</p>
          <p><strong>Size:</strong> ${fileSize}</p>
          <div class="video-preview-note">
            <p>Video preview is handled by the client-side player.</p>
            <p><a href="/api/documents/view/${document.file_id}" target="_blank">View Video</a></p>
            <p><a href="/api/documents/download/${document.document_id}" target="_blank">Download Video</a></p>
          </div>
        </div>
      `;
    } catch (error) {
      console.error(`[VideoDocumentHandler] Error generating HTML for document ${document.document_id}:`, error);
      return '<p>Error generating video content</p>';
    }
  }

  /**
   * Gets the file extension from a filename
   * @param filename The filename
   * @returns The file extension (without the dot)
   */
  private getFileExtension(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    return ext ? ext.substring(1) : '';
  }

  private mapMimeToFormat(mimeType: string | null | undefined): string | null {
    if (!mimeType) {
      return null;
    }

    const map: Record<string, string> = {
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/ogg': 'ogg',
      'video/quicktime': 'mov',
      'video/x-msvideo': 'avi',
      'video/x-ms-wmv': 'asf',
      'video/mpeg': 'mpeg',
      'video/3gpp': '3gp',
      'video/3gpp2': '3gp',
      'video/x-matroska': 'matroska',
      'video/x-flv': 'flv'
    };

    return map[mimeType] || null;
  }

  private async generateThumbnail(document: IDocument, tenant: string, knex: Knex | Knex.Transaction): Promise<Buffer | null> {
    if (!ffmpegExecutable) {
      return null;
    }

    if (!document.file_id) {
      return null;
    }

    try {
      const fileRecord = await knex('external_files')
        .select('storage_path', 'mime_type')
        .where({ tenant, file_id: document.file_id, is_deleted: false })
        .first();

      if (!fileRecord) {
        console.warn(`[VideoDocumentHandler] File record not found for ${document.file_id}`);
        return null;
      }

      const provider = await StorageProviderFactory.createProvider();
      const videoStream = await provider.getReadStream(fileRecord.storage_path);

      const buffer = await this.extractFrameFromStream(
        videoStream,
        fileRecord.mime_type || document.mime_type || null
      );

      return buffer;
    } catch (error) {
      console.error(`[VideoDocumentHandler] Failed to generate thumbnail for ${document.file_id}:`, error);
      return null;
    }
  }

  private async extractFrameFromStream(stream: Readable, mimeType: string | null): Promise<Buffer | null> {
    console.log(`[VideoDocumentHandler] extractFrameFromStream called with mimeType: ${mimeType}`);
    return await new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const command = ffmpeg(stream);

      const format = this.mapMimeToFormat(mimeType);
      if (format) {
        console.log(`[VideoDocumentHandler] Using input format: ${format}`);
        command.inputFormat(format);
      } else {
        console.log(`[VideoDocumentHandler] No specific format mapping for ${mimeType}, letting ffmpeg auto-detect`);
      }

      command.noAudio();
      command.seekInput('00:00:01');
      command.outputOptions(['-frames:v 1', '-vf', 'scale=640:-1']);
      command.format('mjpeg');

      command.on('error', (err) => {
        console.error(`[VideoDocumentHandler] ffmpeg command error:`, err);
        stream.destroy();
        reject(err);
      });

      command.on('end', () => {
        console.log(`[VideoDocumentHandler] ffmpeg processing complete`);
      });

      // Pipe output to capture chunks
      const ffmpegStream = command.pipe();

      ffmpegStream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      ffmpegStream.on('end', () => {
        if (chunks.length === 0) {
          console.log(`[VideoDocumentHandler] No thumbnail data received from ffmpeg`);
          resolve(null);
        } else {
          console.log(`[VideoDocumentHandler] Thumbnail generated, size: ${Buffer.concat(chunks).length} bytes`);
          resolve(Buffer.concat(chunks));
        }
      });

      ffmpegStream.on('error', (err) => {
        console.error(`[VideoDocumentHandler] ffmpeg stream error:`, err);
        stream.destroy();
        reject(err);
      });

      stream.on('error', (err) => {
        console.error(`[VideoDocumentHandler] video stream error:`, err);
        stream.destroy();
        reject(err);
      });
    });
  }
}
