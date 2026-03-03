'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@alga-psa/ui/components/Card';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Download, Lock, FileText, AlertCircle, CheckCircle } from 'lucide-react';

interface ShareInfo {
  documentName: string;
  mimeType: string;
  fileSize: number;
  shareType: 'public' | 'password' | 'portal_authenticated';
  requiresPassword: boolean;
  requiresAuth: boolean;
  expiresAt: string | null;
  maxDownloads: number | null;
  downloadCount: number;
}

function formatFileSize(bytes: number): string {
  if (!bytes) return '--';
  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let size = bytes;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function getFileIcon(mimeType: string): string {
  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType?.startsWith('video/')) return 'video';
  if (mimeType === 'application/pdf') return 'pdf';
  return 'file';
}

export default function ShareLandingPage() {
  const params = useParams();
  const token = params?.token as string;

  const [shareInfo, setShareInfo] = useState<ShareInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  useEffect(() => {
    if (!token) return;

    const fetchInfo = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/share/${token}/info`);
        const data = await response.json();

        if (!response.ok) {
          setError(data.error || 'Failed to load share link');
          return;
        }

        setShareInfo(data);
      } catch (err) {
        setError('Failed to connect to server');
      } finally {
        setIsLoading(false);
      }
    };

    fetchInfo();
  }, [token]);

  const handleDownload = async () => {
    if (!token) return;

    setIsDownloading(true);
    setDownloadError(null);
    setDownloadSuccess(false);

    try {
      const headers: HeadersInit = {};
      if (shareInfo?.requiresPassword && password) {
        headers['x-share-password'] = password;
      }

      const response = await fetch(`/api/share/${token}`, { headers });

      if (!response.ok) {
        if (response.status === 401) {
          setDownloadError('Password required');
        } else if (response.status === 403) {
          setDownloadError('Invalid password');
        } else {
          setDownloadError('Download failed. Please try again.');
        }
        return;
      }

      // Get the blob and trigger download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = shareInfo?.documentName || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Delay revocation to ensure download starts
      setTimeout(() => window.URL.revokeObjectURL(url), 100);

      setDownloadSuccess(true);

      // Refresh info to get updated download count
      const infoResponse = await fetch(`/api/share/${token}/info`);
      if (infoResponse.ok) {
        const data = await infoResponse.json();
        setShareInfo(data);
      }
    } catch (err) {
      setDownloadError('Download failed');
    } finally {
      setIsDownloading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-12 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="mt-4 text-muted-foreground">Loading...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-12 text-center">
            <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Link Not Available</h2>
            <p className="text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!shareInfo) {
    return null;
  }

  const isExpired = shareInfo.expiresAt && new Date(shareInfo.expiresAt) < new Date();
  const isDownloadLimitReached = shareInfo.maxDownloads !== null &&
                                  shareInfo.downloadCount >= shareInfo.maxDownloads;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <FileText className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-xl">{shareInfo.documentName}</CardTitle>
          <CardDescription>
            {formatFileSize(shareInfo.fileSize)} &middot; {shareInfo.mimeType?.split('/')[1]?.toUpperCase() || 'FILE'}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {isExpired && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>This share link has expired.</AlertDescription>
            </Alert>
          )}

          {isDownloadLimitReached && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>Download limit has been reached.</AlertDescription>
            </Alert>
          )}

          {shareInfo.requiresAuth && (
            <Alert>
              <Lock className="h-4 w-4" />
              <AlertDescription>
                This file requires authentication. Please sign in to download.
              </AlertDescription>
            </Alert>
          )}

          {shareInfo.requiresPassword && !isExpired && !isDownloadLimitReached && (
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Lock className="w-4 h-4" />
                Password Required
              </label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && password) {
                    handleDownload();
                  }
                }}
              />
            </div>
          )}

          {downloadError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{downloadError}</AlertDescription>
            </Alert>
          )}

          {downloadSuccess && (
            <Alert>
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertDescription>Download started successfully!</AlertDescription>
            </Alert>
          )}

          <Button
            id="share-download"
            className="w-full"
            onClick={handleDownload}
            disabled={
              isDownloading ||
              isExpired ||
              isDownloadLimitReached ||
              shareInfo.requiresAuth ||
              (shareInfo.requiresPassword && !password)
            }
          >
            {isDownloading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Downloading...
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                Download File
              </>
            )}
          </Button>

          {shareInfo.maxDownloads && (
            <p className="text-xs text-center text-muted-foreground">
              {shareInfo.downloadCount} of {shareInfo.maxDownloads} downloads used
            </p>
          )}

          {shareInfo.expiresAt && !isExpired && (
            <p className="text-xs text-center text-muted-foreground">
              Expires: {new Date(shareInfo.expiresAt).toLocaleString()}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
