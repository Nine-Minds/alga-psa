import { NextRequest, NextResponse } from 'next/server';
import { getReportJob } from '@/lib/actions/guard-actions/reportActions';
import { generateSignedDownloadUrl } from '@/lib/services/guardReportStorage';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const searchParams = request.nextUrl.searchParams;

    // Optional expiration time in seconds (default 1 hour)
    const expirationSeconds = searchParams.get('expiration')
      ? parseInt(searchParams.get('expiration')!, 10)
      : 3600;

    // Validate expiration (max 24 hours)
    if (expirationSeconds < 60 || expirationSeconds > 86400) {
      return NextResponse.json(
        { error: 'Expiration must be between 60 and 86400 seconds' },
        { status: 400 }
      );
    }

    const report = await getReportJob(id);

    if (!report) {
      return NextResponse.json(
        { error: 'Report not found' },
        { status: 404 }
      );
    }

    if (report.status !== 'completed' || !report.file_path) {
      return NextResponse.json(
        { error: 'Report not ready for download' },
        { status: 400 }
      );
    }

    // Check if file is in S3
    if (!report.file_path.startsWith('s3://')) {
      return NextResponse.json(
        { error: 'Signed URLs are only available for S3-stored reports' },
        { status: 400 }
      );
    }

    // Extract S3 key from path (format: s3://bucket/key)
    const s3Uri = new URL(report.file_path);
    const s3Key = s3Uri.pathname.slice(1); // Remove leading slash

    const signedUrl = await generateSignedDownloadUrl(s3Key, expirationSeconds);

    return NextResponse.json({
      url: signedUrl,
      expires_in: expirationSeconds,
      file_name: `${report.name.replace(/[^a-zA-Z0-9-_]/g, '_')}.${report.format}`,
    });
  } catch (error) {
    console.error('Error generating signed URL:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate signed URL' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}
