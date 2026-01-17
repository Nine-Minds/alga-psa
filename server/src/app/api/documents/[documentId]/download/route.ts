import { NextRequest } from 'next/server';
import { downloadDocument } from '@alga-psa/documents/actions/documentActions';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await params;
    
    // The downloadDocument function already handles auth and returns a NextResponse
    return await downloadDocument(documentId);
  } catch (error) {
    console.error('API: Error downloading document:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to download document' }), 
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}
