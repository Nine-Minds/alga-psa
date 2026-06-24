import { NextRequest, NextResponse } from 'next/server';
import { StorageService } from 'server/src/lib/storage/StorageService';
import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/auth/session';
import { canAccessDocument } from 'server/src/lib/utils/documentPermissionUtils';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ fileId: string }> }
) {
    const resolvedParams = await params;
    console.log('GET request received for file download with params:', resolvedParams);
    try {
        const user = await getCurrentUser();
        if (!user?.tenant) {
            return new NextResponse('Unauthorized', { status: 401 });
        }

        console.log('Creating tenant knex connection...');
        const { knex, tenant } = await createTenantKnex(user.tenant);
        if (!tenant) {
            console.log('Tenant not found');
            return new NextResponse('Tenant not found', { status: 404 });
        }
        console.log('Tenant found:', tenant);

        const fileId = resolvedParams.fileId;
        const document = await knex('documents')
            .where({ tenant, file_id: fileId })
            .first();
        if (!document || !(await canAccessDocument(user, document))) {
            return new NextResponse('Not found', { status: 404 });
        }

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
        return new Response(result.buffer as any, {
            status: 200,
            headers,
        });
    } catch (error) {
        console.error('Download error:', error);
        return new Response('Download failed', { status: 500 });
    }
}
