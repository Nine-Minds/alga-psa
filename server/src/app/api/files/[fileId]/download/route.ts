import { NextRequest, NextResponse } from 'next/server';
import { StorageService } from 'server/src/lib/storage/StorageService';
import { createTenantKnex } from 'server/src/lib/db';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ fileId: string }> }
) {
    const resolvedParams = await params;
    console.log('GET request received for file download with params:', resolvedParams);
    try {
        console.log('Creating tenant knex connection...');
        const { tenant } = await createTenantKnex();
        if (!tenant) {
            console.log('Tenant not found');
            return new NextResponse('Tenant not found', { status: 404 });
        }
        console.log('Tenant found:', tenant);

        const fileId = resolvedParams.fileId;
        console.log('Attempting to download file with ID:', fileId);
        
        // Use the static downloadFile method with just the fileId
        const result = await StorageService.downloadFile(fileId);
        console.log('File downloaded successfully. Metadata:', result.metadata);

        // Set appropriate headers for file download
        console.log('Setting response headers...');
        const headers = new Headers();
        headers.set('Content-Type', result.metadata.mime_type || 'application/octet-stream');
        headers.set('Content-Disposition', `attachment; filename="${result.metadata.original_name}"`);
        console.log('Headers set:', Object.fromEntries(headers.entries()));

        console.log('Sending file response...');
        return new NextResponse(result.buffer, {
            status: 200,
            headers,
        });
    } catch (error) {
        console.error('Download error:', error);
        return new NextResponse('Download failed', { status: 500 });
    }
}
