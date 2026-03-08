'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Switch } from '@alga-psa/ui/components/Switch';
import { DateTimePicker } from '@alga-psa/ui/components/DateTimePicker';
import { Badge } from '@alga-psa/ui/components/Badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
} from '@alga-psa/ui/components/Dialog';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import {
  Copy,
  Link2,
  Lock,
  Globe,
  Users,
  Trash2,
  Plus,
  ExternalLink,
  Check,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import {
  createShareLink,
  getShareLinksForDocument,
  revokeShareLink,
  IDocumentShareLink,
  ICreateShareLinkInput,
  ShareType,
} from '@alga-psa/documents/actions';
import { getShareUrl } from '../lib/documentUtils';

interface ShareLinkDialogProps {
  isOpen: boolean;
  onClose: () => void;
  documentId: string;
  documentName: string;
}

const SHARE_TYPE_OPTIONS = [
  { value: 'public', label: 'Public' },
  { value: 'password', label: 'Password Protected' },
  { value: 'portal_authenticated', label: 'Portal Users' },
];

export default function ShareLinkDialog({
  isOpen,
  onClose,
  documentId,
  documentName,
}: ShareLinkDialogProps) {
  const [existingLinks, setExistingLinks] = useState<IDocumentShareLink[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Create form state
  const [shareType, setShareType] = useState<ShareType>('public');
  const [password, setPassword] = useState('');
  const [hasExpiry, setHasExpiry] = useState(false);
  const [expiryDate, setExpiryDate] = useState<Date | undefined>(undefined);
  const [hasMaxDownloads, setHasMaxDownloads] = useState(false);
  const [maxDownloads, setMaxDownloads] = useState('10');

  const loadLinks = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getShareLinksForDocument(documentId);
      if (Array.isArray(result)) {
        setExistingLinks(result);
      }
    } catch (error) {
      handleError(error, 'Failed to load share links');
    } finally {
      setIsLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    if (isOpen && documentId) {
      loadLinks();
    }
  }, [isOpen, documentId, loadLinks]);

  const resetForm = () => {
    setShareType('public');
    setPassword('');
    setHasExpiry(false);
    setExpiryDate(undefined);
    setHasMaxDownloads(false);
    setMaxDownloads('10');
    setShowCreateForm(false);
  };

  const handleCreate = async () => {
    if (shareType === 'password' && !password) {
      toast.error('Password is required');
      return;
    }

    setIsCreating(true);
    try {
      const input: ICreateShareLinkInput = {
        documentId,
        shareType,
        password: shareType === 'password' ? password : undefined,
        expiresAt: hasExpiry && expiryDate ? expiryDate : undefined,
        maxDownloads: hasMaxDownloads ? parseInt(maxDownloads, 10) : undefined,
      };

      const result = await createShareLink(input);
      if ('code' in result) {
        toast.error('Failed to create share link');
        return;
      }

      toast.success('Share link created');
      resetForm();
      await loadLinks();

      // Copy the new link to clipboard
      const shareLink = result as IDocumentShareLink;
      const url = getShareUrl(shareLink.token);
      await navigator.clipboard.writeText(url);
      toast.success('Link copied to clipboard');
    } catch (error) {
      handleError(error, 'Failed to create share link');
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevoke = async (shareId: string) => {
    try {
      const result = await revokeShareLink(shareId);
      if (typeof result === 'object' && 'code' in result) {
        toast.error('Failed to revoke share link');
        return;
      }
      if (result) {
        toast.success('Share link revoked');
        await loadLinks();
      }
    } catch (error) {
      handleError(error, 'Failed to revoke share link');
    }
  };

  const handleCopy = async (token: string, shareId: string) => {
    const url = getShareUrl(token);
    await navigator.clipboard.writeText(url);
    setCopiedId(shareId);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success('Link copied to clipboard');
  };

  const getShareTypeIcon = (type: ShareType) => {
    switch (type) {
      case 'public':
        return <Globe className="w-4 h-4" />;
      case 'password':
        return <Lock className="w-4 h-4" />;
      case 'portal_authenticated':
        return <Users className="w-4 h-4" />;
    }
  };

  const getShareTypeLabel = (type: ShareType) => {
    switch (type) {
      case 'public':
        return 'Public';
      case 'password':
        return 'Password';
      case 'portal_authenticated':
        return 'Portal';
    }
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Share Link">
      <DialogContent className="max-w-lg">
        <DialogDescription>
          Create and manage share links for &ldquo;{documentName}&rdquo;
        </DialogDescription>

        <div className="space-y-4 py-4">
          {/* Existing Links */}
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
            </div>
          ) : (
            <>
              {existingLinks.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Active Links</Label>
                  <div className="space-y-2 max-h-48 overflow-auto">
                    {existingLinks.map((link) => (
                      <div
                        key={link.share_id}
                        className="flex items-center justify-between p-2 rounded-md border bg-muted/30"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {getShareTypeIcon(link.share_type as ShareType)}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                {getShareTypeLabel(link.share_type as ShareType)}
                              </Badge>
                              {link.max_downloads && (
                                <span className="text-xs text-muted-foreground">
                                  {link.download_count}/{link.max_downloads} downloads
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate">
                              Created {new Date(link.created_at).toLocaleDateString()}
                              {link.expires_at && ` • Expires ${new Date(link.expires_at).toLocaleDateString()}`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            id={`share-copy-${link.share_id}`}
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => handleCopy(link.token, link.share_id)}
                          >
                            {copiedId === link.share_id ? (
                              <Check className="w-4 h-4 text-green-600" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </Button>
                          <Button
                            id={`share-open-${link.share_id}`}
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => window.open(getShareUrl(link.token), '_blank')}
                          >
                            <ExternalLink className="w-4 h-4" />
                          </Button>
                          <Button
                            id={`share-revoke-${link.share_id}`}
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                            onClick={() => handleRevoke(link.share_id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Create New Link Form */}
              {showCreateForm ? (
                <div className="space-y-4 border rounded-lg p-4">
                  <CustomSelect
                    label="Share Type"
                    options={SHARE_TYPE_OPTIONS}
                    value={shareType}
                    onValueChange={(v) => setShareType(v as ShareType)}
                    placeholder="Select share type"
                  />

                  {shareType === 'password' && (
                    <div className="space-y-2">
                      <Label>Password</Label>
                      <Input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter a password"
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <Label htmlFor="hasExpiry">Set Expiration Date</Label>
                    <Switch
                      id="hasExpiry"
                      checked={hasExpiry}
                      onCheckedChange={setHasExpiry}
                    />
                  </div>

                  {hasExpiry && (
                    <DateTimePicker
                      id="share-link-expiry"
                      value={expiryDate}
                      onChange={setExpiryDate}
                      clearable
                      minDate={new Date()}
                      placeholder="Select expiration date"
                    />
                  )}

                  <div className="flex items-center justify-between">
                    <Label htmlFor="hasMaxDownloads">Limit Downloads</Label>
                    <Switch
                      id="hasMaxDownloads"
                      checked={hasMaxDownloads}
                      onCheckedChange={setHasMaxDownloads}
                    />
                  </div>

                  {hasMaxDownloads && (
                    <Input
                      type="number"
                      min="1"
                      value={maxDownloads}
                      onChange={(e) => setMaxDownloads(e.target.value)}
                      placeholder="Max downloads"
                    />
                  )}

                  <div className="flex gap-2">
                    <Button
                      id="share-cancel"
                      variant="outline"
                      className="flex-1"
                      onClick={resetForm}
                      disabled={isCreating}
                    >
                      Cancel
                    </Button>
                    <Button
                      id="share-create"
                      className="flex-1"
                      onClick={handleCreate}
                      disabled={isCreating || (shareType === 'password' && !password)}
                    >
                      {isCreating ? 'Creating...' : 'Create Link'}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  id="share-new-link"
                  variant="outline"
                  className="w-full"
                  onClick={() => setShowCreateForm(true)}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Create New Share Link
                </Button>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button id="share-close" variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
