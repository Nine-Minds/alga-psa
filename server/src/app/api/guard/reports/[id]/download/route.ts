import { NextRequest, NextResponse } from 'next/server';
import { getReportDownloadInfo } from '@/lib/actions/guard-actions/reportActions';
import { generateSignedDownloadUrl } from '@/lib/services/guardReportStorage';
import { promises as fs } from 'fs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const downloadInfo = await getReportDownloadInfo(id);

    if (!downloadInfo) {
      return NextResponse.json(
        { error: 'Report not ready for download or not found' },
        { status: 404 }
      );
    }

    const filePath = downloadInfo.file_path;

    // Handle S3 paths - redirect to signed URL
    if (filePath.startsWith('s3://')) {
      // Extract S3 key from path (format: s3://bucket/key)
      const s3Uri = new URL(filePath);
      const s3Key = s3Uri.pathname.slice(1); // Remove leading slash

      try {
        const signedUrl = await generateSignedDownloadUrl(s3Key, 3600); // 1 hour expiration
        // Redirect to the signed URL
        return NextResponse.redirect(signedUrl, 302);
      } catch (s3Error) {
        console.error('Error generating signed URL:', s3Error);
        return NextResponse.json(
          { error: 'Failed to generate download URL' },
          { status: 500 }
        );
      }
    }

    // Handle local file paths
    try {
      const fileBuffer = await fs.readFile(filePath);

      return new NextResponse(fileBuffer, {
        status: 200,
        headers: {
          'Content-Type': downloadInfo.mime_type,
          'Content-Disposition': `attachment; filename="${downloadInfo.file_name}"`,
          'Content-Length': String(downloadInfo.file_size || fileBuffer.length),
        },
      });
    } catch (fileError) {
      console.error('Error reading report file:', fileError);
      return NextResponse.json(
        { error: 'Report file not found' },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error('Error downloading report:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to download report' },
      { status: error instanceof Error && error.message.includes('Permission denied') ? 403 : 500 }
    );
  }
}
