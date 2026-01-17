'use server';

/**
 * Alga Guard - File Processing Utilities
 *
 * Handles text extraction from various file types for PII scanning.
 * Supports: TXT, CSV, JSON, YAML, XML, PDF, DOC, DOCX, XLS, XLSX, ZIP
 */

/* eslint-disable @typescript-eslint/no-require-imports */

// Server-side Node.js imports
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec) as (cmd: string) => Promise<{ stdout: string; stderr: string }>;

// ============================================================================
// Types
// ============================================================================

export interface ExtractedText {
  text: string;
  page_numbers?: number[];
  line_count: number;
  encoding?: string;
  error?: string;
}

export interface FileInfo {
  path: string;
  extension: string;
  size_bytes: number;
  is_binary: boolean;
}

export interface ProcessingConfig {
  max_file_size_bytes: number;
  max_files_per_scan: number;
  max_zip_depth: number;
  max_extracted_zip_size_bytes: number;
  supported_extensions: string[];
  encoding_fallbacks: string[];
}

export interface ProcessingResult {
  file_path: string;
  extracted: ExtractedText | null;
  skipped: boolean;
  skip_reason?: string;
  processing_time_ms: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_PROCESSING_CONFIG: ProcessingConfig = {
  max_file_size_bytes: 50 * 1024 * 1024, // 50 MB
  max_files_per_scan: 100000,
  max_zip_depth: 3,
  max_extracted_zip_size_bytes: 500 * 1024 * 1024, // 500 MB
  supported_extensions: [
    // Text files
    '.txt', '.csv', '.json', '.yaml', '.yml', '.xml', '.log', '.md', '.rtf',
    // Documents
    '.pdf', '.doc', '.docx',
    // Spreadsheets
    '.xls', '.xlsx', '.xlsm',
    // Code files (optional)
    '.js', '.ts', '.py', '.java', '.cs', '.cpp', '.c', '.h', '.go', '.rb',
    '.php', '.sql', '.sh', '.bash', '.ps1', '.html', '.htm', '.css',
    // Archives
    '.zip',
  ],
  encoding_fallbacks: ['utf-8', 'utf-16le', 'utf-16be', 'latin1', 'ascii'],
};

// ============================================================================
// Text File Extensions
// ============================================================================

const TEXT_EXTENSIONS = new Set([
  '.txt', '.csv', '.json', '.yaml', '.yml', '.xml', '.log', '.md', '.rtf',
  '.js', '.ts', '.py', '.java', '.cs', '.cpp', '.c', '.h', '.go', '.rb',
  '.php', '.sql', '.sh', '.bash', '.ps1', '.html', '.htm', '.css', '.ini',
  '.conf', '.cfg', '.env', '.properties',
]);

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get file extension (lowercase)
 */
export function getFileExtension(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

/**
 * Check if file is a supported text file
 */
export function isTextFile(filePath: string): boolean {
  return TEXT_EXTENSIONS.has(getFileExtension(filePath));
}

/**
 * Check if file is supported for processing
 */
export function isSupportedFile(filePath: string, config: ProcessingConfig): boolean {
  const ext = getFileExtension(filePath);
  return config.supported_extensions.includes(ext);
}

/**
 * Detect if content is binary (contains null bytes or high ratio of non-printable chars)
 */
export function isBinaryContent(buffer: Buffer): boolean {
  // Check first 8KB for binary indicators
  const checkLength = Math.min(buffer.length, 8192);

  let nullCount = 0;
  let nonPrintable = 0;

  for (let i = 0; i < checkLength; i++) {
    const byte = buffer[i];

    if (byte === 0) {
      nullCount++;
      if (nullCount > 1) return true; // Multiple nulls = binary
    }

    // Non-printable (excluding common whitespace)
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      nonPrintable++;
    }
  }

  // High ratio of non-printable chars suggests binary
  return (nonPrintable / checkLength) > 0.1;
}

/**
 * Detect encoding of a buffer
 */
export function detectEncoding(buffer: Buffer): string {
  // Check for BOM
  if (buffer.length >= 3) {
    if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
      return 'utf-8';
    }
    if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
      return 'utf-16be';
    }
    if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
      return 'utf-16le';
    }
  }

  // Check for UTF-16 without BOM (null bytes pattern)
  let utf16LeCount = 0;
  let utf16BeCount = 0;
  const checkLen = Math.min(buffer.length, 1000);

  for (let i = 0; i < checkLen - 1; i += 2) {
    if (buffer[i] !== 0 && buffer[i + 1] === 0) utf16LeCount++;
    if (buffer[i] === 0 && buffer[i + 1] !== 0) utf16BeCount++;
  }

  if (utf16LeCount > checkLen / 4) return 'utf-16le';
  if (utf16BeCount > checkLen / 4) return 'utf-16be';

  // Default to UTF-8
  return 'utf-8';
}

/**
 * Decode buffer to string with encoding detection
 */
export function decodeBuffer(buffer: Buffer): { text: string; encoding: string } {
  const encoding = detectEncoding(buffer);

  let text: string;
  if (encoding === 'utf-16le') {
    text = buffer.toString('utf16le');
  } else if (encoding === 'utf-16be') {
    // Node doesn't have native utf-16be, swap bytes
    const swapped = Buffer.alloc(buffer.length);
    for (let i = 0; i < buffer.length - 1; i += 2) {
      swapped[i] = buffer[i + 1];
      swapped[i + 1] = buffer[i];
    }
    text = swapped.toString('utf16le');
  } else {
    text = buffer.toString('utf8');
  }

  // Strip BOM if present
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }

  return { text, encoding };
}

// ============================================================================
// Text Extraction Functions
// ============================================================================

/**
 * Extract text from plain text files
 */
export async function extractTextFile(filePath: string): Promise<ExtractedText> {
  const buffer = await fs.readFile(filePath);

  if (isBinaryContent(buffer)) {
    return {
      text: '',
      line_count: 0,
      error: 'File appears to be binary',
    };
  }

  const { text, encoding } = decodeBuffer(buffer);
  const lineCount = (text.match(/\n/g) || []).length + 1;

  return {
    text,
    line_count: lineCount,
    encoding,
  };
}

/**
 * Extract text from JSON files
 */
export async function extractJsonFile(filePath: string): Promise<ExtractedText> {
  const buffer = await fs.readFile(filePath);
  const { text, encoding } = decodeBuffer(buffer);

  // For JSON, we want to extract all string values
  let extractedStrings: string[] = [];

  const extractStrings = (obj: unknown): void => {
    if (typeof obj === 'string') {
      extractedStrings.push(obj);
    } else if (Array.isArray(obj)) {
      obj.forEach(extractStrings);
    } else if (obj && typeof obj === 'object') {
      Object.values(obj).forEach(extractStrings);
    }
  };

  try {
    const parsed = JSON.parse(text);
    extractStrings(parsed);
  } catch {
    // If JSON parse fails, treat as plain text
    return {
      text,
      line_count: (text.match(/\n/g) || []).length + 1,
      encoding,
    };
  }

  const extractedText = extractedStrings.join('\n');
  return {
    text: extractedText,
    line_count: extractedStrings.length,
    encoding,
  };
}

/**
 * Extract text from CSV files
 */
export async function extractCsvFile(filePath: string): Promise<ExtractedText> {
  const buffer = await fs.readFile(filePath);
  const { text, encoding } = decodeBuffer(buffer);

  // For CSV, extract all cell values (simple parsing)
  const lines = text.split(/\r?\n/);
  const values: string[] = [];

  for (const line of lines) {
    // Simple CSV parsing (handles quoted strings)
    let inQuote = false;
    let currentValue = '';

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuote = !inQuote;
      } else if (char === ',' && !inQuote) {
        if (currentValue.trim()) values.push(currentValue.trim());
        currentValue = '';
      } else {
        currentValue += char;
      }
    }

    if (currentValue.trim()) values.push(currentValue.trim());
  }

  const extractedText = values.join('\n');
  return {
    text: extractedText,
    line_count: values.length,
    encoding,
  };
}

/**
 * Extract text from XML files
 */
export async function extractXmlFile(filePath: string): Promise<ExtractedText> {
  const buffer = await fs.readFile(filePath);
  const { text, encoding } = decodeBuffer(buffer);

  // Extract text content from XML (strip tags)
  const textContent = text
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1') // Extract CDATA content
    .replace(/<[^>]+>/g, '\n') // Remove tags
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\n+/g, '\n') // Collapse multiple newlines
    .trim();

  return {
    text: textContent,
    line_count: (textContent.match(/\n/g) || []).length + 1,
    encoding,
  };
}

/**
 * Extract text from YAML files
 */
export async function extractYamlFile(filePath: string): Promise<ExtractedText> {
  // YAML is essentially plain text, just read it directly
  return extractTextFile(filePath);
}

// ============================================================================
// Document Extraction (Stubs - require external libraries)
// ============================================================================

/**
 * Extract text from PDF files
 * Note: Requires pdf-parse library
 */
export async function extractPdfFile(filePath: string): Promise<ExtractedText> {
  try {
    // Dynamic require to avoid dependency issues if library not installed
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse');
    const buffer = await fs.readFile(filePath);
    const data = await pdfParse(buffer);

    // pdf-parse returns text with page breaks as form feeds (\f)
    const pages = (data.text as string).split('\f');
    const pageNumbers: number[] = [];

    // Track which pages have content
    pages.forEach((pageText: string, idx: number) => {
      if (pageText.trim().length > 0) {
        pageNumbers.push(idx + 1);
      }
    });

    return {
      text: data.text,
      page_numbers: pageNumbers,
      line_count: ((data.text as string).match(/\n/g) || []).length + 1,
    };
  } catch (error) {
    return {
      text: '',
      line_count: 0,
      error: `PDF extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Extract text from DOCX files
 * Note: Requires mammoth library
 */
export async function extractDocxFile(filePath: string): Promise<ExtractedText> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });

    return {
      text: result.value,
      line_count: ((result.value as string).match(/\n/g) || []).length + 1,
    };
  } catch (error) {
    return {
      text: '',
      line_count: 0,
      error: `DOCX extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Extract text from DOC files (legacy Word format)
 * Note: Requires antiword system binary or textract library
 */
export async function extractDocFile(filePath: string): Promise<ExtractedText> {
  try {
    // Try antiword first (commonly available on Linux)
    const { stdout } = await execAsync(`antiword "${filePath}"`);

    return {
      text: stdout,
      line_count: (stdout.match(/\n/g) || []).length + 1,
    };
  } catch (error) {
    return {
      text: '',
      line_count: 0,
      error: `DOC extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}. Ensure antiword is installed.`,
    };
  }
}

/**
 * Extract text from Excel files (XLS/XLSX)
 * Note: Requires xlsx library
 */
export async function extractExcelFile(filePath: string): Promise<ExtractedText> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const XLSX = require('xlsx');
    const workbook = XLSX.readFile(filePath);

    const allText: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

      for (const row of json) {
        if (Array.isArray(row)) {
          const rowText = row
            .filter((cell): cell is string | number => cell !== null && cell !== undefined)
            .map((cell: string | number) => String(cell))
            .join(' ');
          if (rowText.trim()) allText.push(rowText);
        }
      }
    }

    const text = allText.join('\n');
    return {
      text,
      line_count: allText.length,
    };
  } catch (error) {
    return {
      text: '',
      line_count: 0,
      error: `Excel extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

// ============================================================================
// Archive Handling
// ============================================================================

/**
 * Process ZIP archive
 * Note: Requires adm-zip library
 */
export async function processZipArchive(
  zipPath: string,
  config: ProcessingConfig,
  currentDepth: number = 0,
): Promise<ProcessingResult[]> {
  if (currentDepth >= config.max_zip_depth) {
    return [{
      file_path: zipPath,
      extracted: null,
      skipped: true,
      skip_reason: `Max ZIP depth (${config.max_zip_depth}) exceeded`,
      processing_time_ms: 0,
    }];
  }

  const results: ProcessingResult[] = [];

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();

    let totalExtractedSize = 0;

    for (const entry of entries) {
      if (entry.isDirectory) continue;

      // Check extracted size limit
      totalExtractedSize += entry.header.size;
      if (totalExtractedSize > config.max_extracted_zip_size_bytes) {
        results.push({
          file_path: `${zipPath}!${entry.entryName}`,
          extracted: null,
          skipped: true,
          skip_reason: 'Exceeded max extracted ZIP size limit',
          processing_time_ms: 0,
        });
        break;
      }

      const entryPath = `${zipPath}!${entry.entryName}`;
      const ext = getFileExtension(entry.entryName);

      if (!config.supported_extensions.includes(ext)) {
        results.push({
          file_path: entryPath,
          extracted: null,
          skipped: true,
          skip_reason: `Unsupported extension: ${ext}`,
          processing_time_ms: 0,
        });
        continue;
      }

      const startTime = Date.now();

      // Handle nested ZIP
      if (ext === '.zip') {
        // Write to temp file and process recursively
        const tempPath = `/tmp/alga-guard-${Date.now()}-${path.basename(entry.entryName)}`;
        zip.extractEntryTo(entry, '/tmp', false, true);
        const nestedResults = await processZipArchive(tempPath, config, currentDepth + 1);
        results.push(...nestedResults);
        await fs.unlink(tempPath).catch(() => {}); // Clean up
        continue;
      }

      // Extract content from buffer
      const buffer = entry.getData();

      if (isBinaryContent(buffer)) {
        results.push({
          file_path: entryPath,
          extracted: null,
          skipped: true,
          skip_reason: 'Binary file',
          processing_time_ms: Date.now() - startTime,
        });
        continue;
      }

      const { text, encoding } = decodeBuffer(buffer);
      results.push({
        file_path: entryPath,
        extracted: {
          text,
          line_count: (text.match(/\n/g) || []).length + 1,
          encoding,
        },
        skipped: false,
        processing_time_ms: Date.now() - startTime,
      });
    }
  } catch (error) {
    results.push({
      file_path: zipPath,
      extracted: null,
      skipped: true,
      skip_reason: `ZIP processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      processing_time_ms: 0,
    });
  }

  return results;
}

// ============================================================================
// Main Processing Function
// ============================================================================

/**
 * Process a single file and extract text
 */
export async function processFile(
  filePath: string,
  config: ProcessingConfig = DEFAULT_PROCESSING_CONFIG,
): Promise<ProcessingResult> {
  const startTime = Date.now();
  const ext = getFileExtension(filePath);

  // Check if supported
  if (!config.supported_extensions.includes(ext)) {
    return {
      file_path: filePath,
      extracted: null,
      skipped: true,
      skip_reason: `Unsupported extension: ${ext}`,
      processing_time_ms: Date.now() - startTime,
    };
  }

  // Check file size
  try {
    const stats = await fs.stat(filePath);
    if (stats.size > config.max_file_size_bytes) {
      return {
        file_path: filePath,
        extracted: null,
        skipped: true,
        skip_reason: `File size (${stats.size} bytes) exceeds limit (${config.max_file_size_bytes} bytes)`,
        processing_time_ms: Date.now() - startTime,
      };
    }
  } catch {
    return {
      file_path: filePath,
      extracted: null,
      skipped: true,
      skip_reason: 'File not accessible',
      processing_time_ms: Date.now() - startTime,
    };
  }

  // Extract based on file type
  let extracted: ExtractedText;

  try {
    switch (ext) {
      case '.txt':
      case '.log':
      case '.md':
      case '.rtf':
      case '.ini':
      case '.conf':
      case '.cfg':
      case '.env':
      case '.properties':
      case '.js':
      case '.ts':
      case '.py':
      case '.java':
      case '.cs':
      case '.cpp':
      case '.c':
      case '.h':
      case '.go':
      case '.rb':
      case '.php':
      case '.sql':
      case '.sh':
      case '.bash':
      case '.ps1':
      case '.html':
      case '.htm':
      case '.css':
        extracted = await extractTextFile(filePath);
        break;

      case '.json':
        extracted = await extractJsonFile(filePath);
        break;

      case '.csv':
        extracted = await extractCsvFile(filePath);
        break;

      case '.xml':
        extracted = await extractXmlFile(filePath);
        break;

      case '.yaml':
      case '.yml':
        extracted = await extractYamlFile(filePath);
        break;

      case '.pdf':
        extracted = await extractPdfFile(filePath);
        break;

      case '.doc':
        extracted = await extractDocFile(filePath);
        break;

      case '.docx':
        extracted = await extractDocxFile(filePath);
        break;

      case '.xls':
      case '.xlsx':
      case '.xlsm':
        extracted = await extractExcelFile(filePath);
        break;

      default:
        // Try as plain text
        extracted = await extractTextFile(filePath);
    }
  } catch (error) {
    return {
      file_path: filePath,
      extracted: null,
      skipped: true,
      skip_reason: `Extraction error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      processing_time_ms: Date.now() - startTime,
    };
  }

  return {
    file_path: filePath,
    extracted: extracted.error ? null : extracted,
    skipped: !!extracted.error,
    skip_reason: extracted.error,
    processing_time_ms: Date.now() - startTime,
  };
}

/**
 * Process multiple files with batching
 */
export async function processFiles(
  filePaths: string[],
  config: ProcessingConfig = DEFAULT_PROCESSING_CONFIG,
  onProgress?: (processed: number, total: number) => void,
): Promise<ProcessingResult[]> {
  const results: ProcessingResult[] = [];
  const total = Math.min(filePaths.length, config.max_files_per_scan);

  for (let i = 0; i < total; i++) {
    const filePath = filePaths[i];
    const ext = getFileExtension(filePath);

    if (ext === '.zip') {
      const zipResults = await processZipArchive(filePath, config);
      results.push(...zipResults);
    } else {
      const result = await processFile(filePath, config);
      results.push(result);
    }

    if (onProgress) {
      onProgress(i + 1, total);
    }
  }

  return results;
}
