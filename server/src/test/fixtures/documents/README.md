# Document Test Fixtures

This directory contains sample files for testing the document system.

## Files

- `sample.txt` - Plain text file for basic upload testing
- `sample.pdf` - PDF file for preview/thumbnail generation testing
- `sample.png` - Image file for thumbnail generation testing
- `sample.jpg` - JPEG image for format testing
- `large-file.txt` - Large file for size validation testing
- `invalid-type.exe` - Invalid file type for negative testing

## Usage

These fixtures are used by:
- Unit tests for file validation
- Integration tests for upload functionality
- E2E tests for complete document workflows

## Regenerating Fixtures

If you need to regenerate these fixtures, use the `generateTestFixtures.ts` script in this directory.
