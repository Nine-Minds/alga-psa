/**
 * Unit tests for Alga Guard File Processing Utilities
 *
 * Tests the file processing business logic including:
 * - File extension detection
 * - Binary content detection
 * - Encoding detection
 * - Buffer decoding
 * - Support for various file types
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const NodeBuffer = require('buffer').Buffer;

import { describe, it, expect } from 'vitest';
import {
  getFileExtension,
  isTextFile,
  isSupportedFile,
  isBinaryContent,
  detectEncoding,
  decodeBuffer,
  DEFAULT_PROCESSING_CONFIG,
} from './fileProcessing';

// ============================================================================
// File Extension Tests
// ============================================================================

describe('getFileExtension', () => {
  it('should return lowercase extension', () => {
    expect(getFileExtension('/path/to/file.TXT')).toBe('.txt');
    expect(getFileExtension('/path/to/file.JSON')).toBe('.json');
    expect(getFileExtension('/path/to/file.PDF')).toBe('.pdf');
  });

  it('should handle multiple dots in filename', () => {
    expect(getFileExtension('/path/to/file.backup.txt')).toBe('.txt');
    expect(getFileExtension('/path/to/archive.tar.gz')).toBe('.gz');
  });

  it('should return empty string for files without extension', () => {
    expect(getFileExtension('/path/to/README')).toBe('');
    expect(getFileExtension('/path/to/Makefile')).toBe('');
  });

  it('should handle hidden files', () => {
    expect(getFileExtension('/path/to/.gitignore')).toBe('');
    expect(getFileExtension('/path/to/.env.local')).toBe('.local');
  });
});

// ============================================================================
// Text File Detection Tests
// ============================================================================

describe('isTextFile', () => {
  it('should identify common text files', () => {
    expect(isTextFile('/path/to/file.txt')).toBe(true);
    expect(isTextFile('/path/to/file.csv')).toBe(true);
    expect(isTextFile('/path/to/file.json')).toBe(true);
    expect(isTextFile('/path/to/file.yaml')).toBe(true);
    expect(isTextFile('/path/to/file.yml')).toBe(true);
    expect(isTextFile('/path/to/file.xml')).toBe(true);
    expect(isTextFile('/path/to/file.md')).toBe(true);
    expect(isTextFile('/path/to/file.log')).toBe(true);
  });

  it('should identify code files', () => {
    expect(isTextFile('/path/to/file.js')).toBe(true);
    expect(isTextFile('/path/to/file.ts')).toBe(true);
    expect(isTextFile('/path/to/file.py')).toBe(true);
    expect(isTextFile('/path/to/file.java')).toBe(true);
    expect(isTextFile('/path/to/file.cs')).toBe(true);
    expect(isTextFile('/path/to/file.go')).toBe(true);
    expect(isTextFile('/path/to/file.rb')).toBe(true);
    expect(isTextFile('/path/to/file.php')).toBe(true);
    expect(isTextFile('/path/to/file.sql')).toBe(true);
  });

  it('should identify config files', () => {
    expect(isTextFile('/path/to/file.ini')).toBe(true);
    expect(isTextFile('/path/to/file.conf')).toBe(true);
    expect(isTextFile('/path/to/file.cfg')).toBe(true);
    expect(isTextFile('/path/to/file.env')).toBe(true);
    expect(isTextFile('/path/to/file.properties')).toBe(true);
  });

  it('should identify shell scripts', () => {
    expect(isTextFile('/path/to/script.sh')).toBe(true);
    expect(isTextFile('/path/to/script.bash')).toBe(true);
    expect(isTextFile('/path/to/script.ps1')).toBe(true);
  });

  it('should not identify binary files as text', () => {
    expect(isTextFile('/path/to/file.pdf')).toBe(false);
    expect(isTextFile('/path/to/file.docx')).toBe(false);
    expect(isTextFile('/path/to/file.xlsx')).toBe(false);
    expect(isTextFile('/path/to/file.zip')).toBe(false);
    expect(isTextFile('/path/to/file.exe')).toBe(false);
    expect(isTextFile('/path/to/file.jpg')).toBe(false);
  });
});

// ============================================================================
// Supported File Tests
// ============================================================================

describe('isSupportedFile', () => {
  it('should support text files', () => {
    expect(isSupportedFile('/path/to/file.txt', DEFAULT_PROCESSING_CONFIG)).toBe(true);
    expect(isSupportedFile('/path/to/file.csv', DEFAULT_PROCESSING_CONFIG)).toBe(true);
    expect(isSupportedFile('/path/to/file.json', DEFAULT_PROCESSING_CONFIG)).toBe(true);
  });

  it('should support document files', () => {
    expect(isSupportedFile('/path/to/file.pdf', DEFAULT_PROCESSING_CONFIG)).toBe(true);
    expect(isSupportedFile('/path/to/file.doc', DEFAULT_PROCESSING_CONFIG)).toBe(true);
    expect(isSupportedFile('/path/to/file.docx', DEFAULT_PROCESSING_CONFIG)).toBe(true);
  });

  it('should support spreadsheet files', () => {
    expect(isSupportedFile('/path/to/file.xls', DEFAULT_PROCESSING_CONFIG)).toBe(true);
    expect(isSupportedFile('/path/to/file.xlsx', DEFAULT_PROCESSING_CONFIG)).toBe(true);
    expect(isSupportedFile('/path/to/file.xlsm', DEFAULT_PROCESSING_CONFIG)).toBe(true);
  });

  it('should support archive files', () => {
    expect(isSupportedFile('/path/to/file.zip', DEFAULT_PROCESSING_CONFIG)).toBe(true);
  });

  it('should not support unsupported file types', () => {
    expect(isSupportedFile('/path/to/file.exe', DEFAULT_PROCESSING_CONFIG)).toBe(false);
    expect(isSupportedFile('/path/to/file.dll', DEFAULT_PROCESSING_CONFIG)).toBe(false);
    expect(isSupportedFile('/path/to/file.jpg', DEFAULT_PROCESSING_CONFIG)).toBe(false);
    expect(isSupportedFile('/path/to/file.mp3', DEFAULT_PROCESSING_CONFIG)).toBe(false);
  });
});

// ============================================================================
// Binary Content Detection Tests
// ============================================================================

describe('isBinaryContent', () => {
  it('should identify text content', () => {
    const textContent = NodeBuffer.from('Hello, world! This is plain text.\nLine 2\n', 'utf-8');
    expect(isBinaryContent(textContent)).toBe(false);
  });

  it('should identify content with UTF-8 BOM as text', () => {
    const bomContent = NodeBuffer.concat([
      NodeBuffer.from([0xEF, 0xBB, 0xBF]), // UTF-8 BOM
      NodeBuffer.from('Hello, world!', 'utf-8'),
    ]);
    expect(isBinaryContent(bomContent)).toBe(false);
  });

  it('should identify binary content with null bytes', () => {
    const binaryContent = NodeBuffer.from([0x00, 0x01, 0x02, 0x00, 0x04, 0x05]);
    expect(isBinaryContent(binaryContent)).toBe(true);
  });

  it('should identify content with high ratio of non-printable chars as binary', () => {
    // Create buffer with many non-printable chars
    const chars: number[] = [];
    for (let i = 0; i < 100; i++) {
      chars.push(i % 32 === 0 ? 65 : (i % 10)); // Mix of control chars and 'A'
    }
    const mixedContent = NodeBuffer.from(chars);
    expect(isBinaryContent(mixedContent)).toBe(true);
  });

  it('should allow common whitespace characters', () => {
    const whitespaceContent = NodeBuffer.from('Line 1\t\r\nLine 2\t\nLine 3', 'utf-8');
    expect(isBinaryContent(whitespaceContent)).toBe(false);
  });
});

// ============================================================================
// Encoding Detection Tests
// ============================================================================

describe('detectEncoding', () => {
  it('should detect UTF-8 BOM', () => {
    const utf8Bom = NodeBuffer.concat([
      NodeBuffer.from([0xEF, 0xBB, 0xBF]),
      NodeBuffer.from('Hello', 'utf-8'),
    ]);
    expect(detectEncoding(utf8Bom)).toBe('utf-8');
  });

  it('should detect UTF-16 LE BOM', () => {
    const utf16LeBom = NodeBuffer.concat([
      NodeBuffer.from([0xFF, 0xFE]),
      NodeBuffer.from('Hello', 'utf16le'),
    ]);
    expect(detectEncoding(utf16LeBom)).toBe('utf-16le');
  });

  it('should detect UTF-16 BE BOM', () => {
    const utf16BeBom = NodeBuffer.concat([
      NodeBuffer.from([0xFE, 0xFF]),
      NodeBuffer.from([0x00, 0x48, 0x00, 0x65, 0x00, 0x6C, 0x00, 0x6C, 0x00, 0x6F]), // "Hello" in UTF-16 BE
    ]);
    expect(detectEncoding(utf16BeBom)).toBe('utf-16be');
  });

  it('should default to UTF-8 for regular ASCII', () => {
    const asciiContent = NodeBuffer.from('Hello, world!', 'utf-8');
    expect(detectEncoding(asciiContent)).toBe('utf-8');
  });
});

// ============================================================================
// Buffer Decoding Tests
// ============================================================================

describe('decodeBuffer', () => {
  it('should decode UTF-8 content', () => {
    const content = NodeBuffer.from('Hello, world! Special chars: äöü', 'utf-8');
    const result = decodeBuffer(content);

    expect(result.text).toContain('Hello, world!');
    expect(result.text).toContain('äöü');
    expect(result.encoding).toBe('utf-8');
  });

  it('should decode UTF-8 with BOM and strip BOM', () => {
    const content = NodeBuffer.concat([
      NodeBuffer.from([0xEF, 0xBB, 0xBF]),
      NodeBuffer.from('Hello', 'utf-8'),
    ]);
    const result = decodeBuffer(content);

    expect(result.text).toBe('Hello');
    expect(result.text.charCodeAt(0)).not.toBe(0xFEFF); // BOM should be stripped
    expect(result.encoding).toBe('utf-8');
  });

  it('should decode UTF-16 LE content', () => {
    const content = NodeBuffer.concat([
      NodeBuffer.from([0xFF, 0xFE]),
      NodeBuffer.from('Hi', 'utf16le'),
    ]);
    const result = decodeBuffer(content);

    expect(result.encoding).toBe('utf-16le');
  });

  it('should handle empty buffer', () => {
    const content = NodeBuffer.from('');
    const result = decodeBuffer(content);

    expect(result.text).toBe('');
    expect(result.encoding).toBe('utf-8');
  });
});

// ============================================================================
// Default Configuration Tests
// ============================================================================

describe('DEFAULT_PROCESSING_CONFIG', () => {
  it('should have reasonable defaults', () => {
    expect(DEFAULT_PROCESSING_CONFIG.max_file_size_bytes).toBe(50 * 1024 * 1024); // 50 MB
    expect(DEFAULT_PROCESSING_CONFIG.max_files_per_scan).toBe(100000);
    expect(DEFAULT_PROCESSING_CONFIG.max_zip_depth).toBe(3);
    expect(DEFAULT_PROCESSING_CONFIG.max_extracted_zip_size_bytes).toBe(500 * 1024 * 1024); // 500 MB
  });

  it('should include common file extensions', () => {
    const extensions = DEFAULT_PROCESSING_CONFIG.supported_extensions;

    // Text
    expect(extensions).toContain('.txt');
    expect(extensions).toContain('.csv');
    expect(extensions).toContain('.json');
    expect(extensions).toContain('.yaml');
    expect(extensions).toContain('.yml');
    expect(extensions).toContain('.xml');

    // Documents
    expect(extensions).toContain('.pdf');
    expect(extensions).toContain('.doc');
    expect(extensions).toContain('.docx');

    // Spreadsheets
    expect(extensions).toContain('.xls');
    expect(extensions).toContain('.xlsx');

    // Archives
    expect(extensions).toContain('.zip');
  });

  it('should include code file extensions', () => {
    const extensions = DEFAULT_PROCESSING_CONFIG.supported_extensions;

    expect(extensions).toContain('.js');
    expect(extensions).toContain('.ts');
    expect(extensions).toContain('.py');
    expect(extensions).toContain('.java');
    expect(extensions).toContain('.sql');
  });

  it('should have encoding fallbacks', () => {
    expect(DEFAULT_PROCESSING_CONFIG.encoding_fallbacks).toContain('utf-8');
    expect(DEFAULT_PROCESSING_CONFIG.encoding_fallbacks).toContain('latin1');
    expect(DEFAULT_PROCESSING_CONFIG.encoding_fallbacks).toContain('ascii');
  });
});
