import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';

export async function GET(
  request: NextRequest,
  { params }: { params: { extension: string; path: string[] } }
) {
  try {
    const { extension, path } = params;
    
    // Map database UUIDs to actual extension folder names
    const extensionMapping: Record<string, string> = {
      '63a7a0dc-7836-4a5f-aa08-ecdb31b064b5': 'softwareone'
    };
    
    const extensionFolder = extensionMapping[extension] || extension;
    const filePath = join(process.cwd(), '../../extensions', `${extensionFolder}-ext`, 'dist', ...path);
    
    console.log(`[Extension Static] Serving file: ${filePath}`);
    
    const fileContent = await readFile(filePath, 'utf-8');
    
    // Determine content type based on file extension
    const fileExtension = path[path.length - 1]?.split('.').pop()?.toLowerCase();
    let contentType = 'text/plain';
    
    switch (fileExtension) {
      case 'json':
        contentType = 'application/json';
        break;
      case 'js':
        contentType = 'application/javascript';
        break;
      case 'css':
        contentType = 'text/css';
        break;
      case 'html':
        contentType = 'text/html';
        break;
    }
    
    return new NextResponse(fileContent, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  } catch (error) {
    console.error(`[Extension Static] Error serving file:`, error);
    return new NextResponse('File not found', { status: 404 });
  }
}