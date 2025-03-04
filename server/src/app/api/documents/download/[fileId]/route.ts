import { NextRequest } from 'next/server';
import { downloadDocument } from 'server/src/lib/actions/document-actions/documentActions';

export async function GET(
    request: NextRequest,
    { params }: { params: { fileId: string } }
) {
    try {
        return await downloadDocument(params.fileId);
    } catch (error) {
        console.error('Error in download route:', error);
        return new Response('Internal Server Error', { status: 500 });
    }
}
