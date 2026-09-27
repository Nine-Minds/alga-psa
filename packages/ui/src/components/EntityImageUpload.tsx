'use client';

import * as React from 'react';
import { useState, useRef, useTransition } from 'react';
import { toast } from 'react-hot-toast';
import { handleError } from '../lib/errorHandling';
import { Pen, Trash2, Upload, Link, Crop } from 'lucide-react';
import type { LogoCropRect } from '@alga-psa/types';
import LoadingIndicator from './LoadingIndicator';
import { Button } from './Button';
import UserAvatar from './UserAvatar';
import ClientAvatar from './ClientAvatar';
import { ConfirmationDialog } from './ConfirmationDialog';
import { ImageCropDialog } from './ImageCropDialog';
import { useTranslation } from '../lib/i18n/client';

export type EntityType = 'user' | 'contact' | 'client' | 'tenant' | 'team';

export type LinkDocumentAsAvatarResult = {
  success: boolean;
  message?: string;
  imageUrl?: string | null;
  error?: string;
};

interface EntityImageUploadProps {
  entityType: EntityType;
  entityId: string;
  entityName: string;
  imageUrl: string | null;
  /**
   * Uncropped wordmark the square image was cut from, when there is one. It
   * fills 'auto' slots and is what "Adjust mark" re-crops from.
   */
  wideImageUrl?: string | null;
  /** Second argument carries the wide URL whenever this component knows it. */
  onImageChange?: (newImageUrl: string | null, wideImageUrl?: string | null) => void;
  uploadAction: (entityId: string, formData: FormData) => Promise<{
    success: boolean;
    message?: string;
    imageUrl?: string | null;
    /** Present (possibly null) when the action also governs the wide variant. */
    wideImageUrl?: string | null;
    error?: string;
  }>;
  deleteAction: (entityId: string) => Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }>;
  userType?: string;
  userEntityId?: string;
  canModify?: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /**
   * How the current image is previewed. 'circle' is the cover-cropped avatar.
   * 'square' keeps the round frame the app renders logos in but contains the
   * image instead of cropping it; 'rect' is the landscape frame for wide
   * wordmarks and favicons. 'auto' is the circle avatar until the image turns
   * out to be a wide wordmark, which then renders contained at the avatar's
   * height instead of being cropped to its middle.
   */
  previewShape?: 'circle' | 'square' | 'rect' | 'auto';
  /** File input `accept` filter; defaults to any image. */
  accept?: string;
  /**
   * Warns — never blocks — when the picked image's aspect ratio does not match
   * what this slot is for. The caller owns the copy so it stays in its own i18n
   * namespace.
   */
  aspectHint?: { expects: 'square' | 'wide'; warning: string };
  /**
   * Wide uploads open the crop dialog so the square image shows a chosen zone
   * of the wordmark rather than its middle. The upload then carries a `crop`
   * form field with fractions of the source.
   */
  cropWideToSquare?: boolean;
  /** Cuts a new square from `wideImageUrl` server-side; enables "Adjust mark". */
  recropAction?: (entityId: string, crop: LogoCropRect) => Promise<{
    success: boolean;
    message?: string;
    imageUrl?: string | null;
    error?: string;
  }>;
  /** Where the chosen square ends up, for the crop dialog; the caller knows the slot. */
  cropHelpText?: string;
  linkDocumentAsAvatar?: (args: {
    entityType: EntityType;
    entityId: string;
    documentId: string;
  }) => Promise<LinkDocumentAsAvatarResult>;
  renderDocumentSelector?: (args: {
    isOpen: boolean;
    onClose: () => void;
    onSelectDocumentId: (documentId: string) => void;
    entityType: EntityType;
    entityId: string;
  }) => React.ReactNode;
}

// Width/height ratio from which an image counts as a wordmark rather than a mark.
const WIDE_ASPECT_RATIO = 1.5;

// Landscape frame for 'auto' wordmarks: the avatar's height, up to 4x as wide.
const WIDE_FRAME_CLASS: Record<NonNullable<EntityImageUploadProps['size']>, string> = {
  sm: 'h-8 max-w-32',
  md: 'h-10 max-w-40',
  lg: 'h-12 max-w-48',
  xl: 'h-16 max-w-64',
};

const EntityImageUpload = ({
  entityType,
  entityId,
  entityName,
  imageUrl,
  wideImageUrl = null,
  onImageChange,
  uploadAction,
  deleteAction,
  userType,
  userEntityId,
  canModify = true,
  className,
  size = 'lg',
  previewShape = 'circle',
  accept = 'image/*',
  aspectHint,
  cropWideToSquare = false,
  recropAction,
  cropHelpText,
  linkDocumentAsAvatar,
  renderDocumentSelector,
}: EntityImageUploadProps) => {
  const { t } = useTranslation('client-portal');
  const { t: tCore } = useTranslation('common');
  const [isEditing, setIsEditing] = useState(false);
  const [isPendingUpload, startUploadTransition] = useTransition();
  const [isPendingDelete, startDeleteTransition] = useTransition();
  const [isPendingLink, startLinkTransition] = useTransition();
  const [isPendingRecrop, startRecropTransition] = useTransition();
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(imageUrl);
  const [currentWideUrl, setCurrentWideUrl] = useState<string | null>(wideImageUrl);
  // What the crop dialog is cutting: a fresh upload (held until confirmed) or the stored wordmark.
  const [cropRequest, setCropRequest] = useState<{ imageUrl: string; file?: File } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDocumentSelectorOpen, setIsDocumentSelectorOpen] = useState(false);
  const [isWideImage, setIsWideImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Use the preview URL if available, otherwise use the current image URL
  const displayUrl = previewUrl || currentImageUrl;

  // 'auto' needs the real dimensions; the avatar's own <img> is internal, so
  // probe the same (cached) URL here. Undecodable images stay in the circle.
  // A known wide variant needs no probe: it is rendered outright.
  React.useEffect(() => {
    if (previewShape !== 'auto' || !displayUrl || (currentWideUrl && !previewUrl)) {
      setIsWideImage(false);
      return;
    }
    let cancelled = false;
    const probe = new Image();
    probe.onload = () => {
      if (cancelled) return;
      setIsWideImage(probe.naturalHeight > 0 && probe.naturalWidth / probe.naturalHeight > WIDE_ASPECT_RATIO);
    };
    probe.onerror = () => {
      if (!cancelled) setIsWideImage(false);
    };
    probe.src = displayUrl;
    return () => {
      cancelled = true;
    };
  }, [previewShape, displayUrl, previewUrl, currentWideUrl]);

  // Update local state when prop changes
  React.useEffect(() => {
    setCurrentImageUrl(imageUrl);
    // Clear any preview when the actual image changes
    setPreviewUrl(null);
  }, [imageUrl]);

  React.useEffect(() => {
    setCurrentWideUrl(wideImageUrl);
  }, [wideImageUrl]);

  // Clean up object URLs when component unmounts or preview changes
  React.useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // Determine if the current user has permission to modify this entity's image
  const canModifyImage = React.useMemo(() => {
    if (canModify === false) return false;
    
    // For contacts: client users can only modify their own linked contact's avatar
    if (entityType === 'contact' && userType === 'client') {
      return userEntityId === entityId;
    }
    
    return true;
  }, [canModify, entityType, userType, userEntityId, entityId]);

  // Width/height of a picked file, or null when the browser cannot decode it (SVGs).
  const measureAspectRatio = async (file: File): Promise<number | null> => {
    if (typeof createImageBitmap !== 'function') return null;
    try {
      const bitmap = await createImageBitmap(file);
      const ratio = bitmap.width / bitmap.height;
      bitmap.close?.();
      return ratio;
    } catch {
      return null;
    }
  };

  // A wordmark dropped into the square slot (or a square mark into the wide one)
  // still uploads — the tenant just gets told which slot it belongs in.
  const warnOnAspectMismatch = (ratio: number | null) => {
    if (!aspectHint || ratio === null) return;
    const mismatched = aspectHint.expects === 'wide' ? ratio < WIDE_ASPECT_RATIO : ratio > WIDE_ASPECT_RATIO;
    if (mismatched) {
      toast(aspectHint.warning, { icon: '⚠️' });
    }
  };

  const timestamped = (url: string) => `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;

  const startUpload = (file: File, crop: LogoCropRect | null) => {
    const formData = new FormData();
    formData.append((entityType === 'client' || entityType === 'tenant') ? 'logo' : 'avatar', file);
    if (crop) {
      formData.append('crop', JSON.stringify(crop));
    }

    // Create a local object URL for immediate display
    const localImageUrl = URL.createObjectURL(file);
    // Set the preview URL for immediate feedback
    setPreviewUrl(localImageUrl);

    startUploadTransition(async () => {
      try {
        const result = await uploadAction(entityId, formData);

        if (result.success) {
          // Preview URL will be cleaned up in the useEffect

          const serverImageUrl = result.imageUrl || null;
          // Only an action that owns the wide variant reports it; others leave it be.
          const nextWideUrl = result.wideImageUrl === undefined
            ? currentWideUrl
            : (result.wideImageUrl ? timestamped(result.wideImageUrl) : null);

          if (serverImageUrl) {
            const timestampedUrl = timestamped(serverImageUrl);

            console.log(`EntityImageUpload: Setting image URL to: ${timestampedUrl}`);

            // Clear the preview first
            setPreviewUrl(null);

            if (onImageChange) {
              onImageChange(null, nextWideUrl);
            }

            // Small delay to allow for transition effects
            setTimeout(() => {
              setCurrentImageUrl(timestampedUrl);
              setCurrentWideUrl(nextWideUrl);

              if (onImageChange) {
                onImageChange(timestampedUrl, nextWideUrl);
              }
            }, 50);
          } else {
            console.warn('Upload succeeded but no image URL was returned');
          }

          setIsEditing(false);
          toast.success(result.message || `${entityType} image uploaded successfully.`);
        } else {
          // Clear the preview on error
          setPreviewUrl(null);
          setCurrentImageUrl(imageUrl);
          throw new Error(result.error || `Failed to upload ${entityType} image.`);
        }
      } catch (err: any) {
        handleError(err, `Failed to upload ${entityType} image.`);
        URL.revokeObjectURL(localImageUrl);
        setCurrentImageUrl(imageUrl);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Client-side validation
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file.');
      e.target.value = '';
      return;
    }

    // Check file size (2MB limit)
    const maxSize = 2 * 1024 * 1024; // 2MB in bytes
    if (file.size > maxSize) {
      toast.error('Image size must be less than 2MB.');
      e.target.value = '';
      return;
    }

    const ratio = await measureAspectRatio(file);

    // A wordmark heading for a square slot: let the user pick the zone first.
    // The upload waits in cropRequest until the dialog confirms or cancels.
    if (cropWideToSquare && ratio !== null && ratio > WIDE_ASPECT_RATIO) {
      setCropRequest({ imageUrl: URL.createObjectURL(file), file });
      return;
    }

    warnOnAspectMismatch(ratio);
    startUpload(file, null);
  };

  const closeCropDialog = () => {
    if (cropRequest?.file) {
      URL.revokeObjectURL(cropRequest.imageUrl);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
    setCropRequest(null);
  };

  const handleCropConfirm = (crop: LogoCropRect) => {
    if (!cropRequest) return;
    const { file, imageUrl: sourceUrl } = cropRequest;

    if (file) {
      URL.revokeObjectURL(sourceUrl);
      setCropRequest(null);
      startUpload(file, crop);
      return;
    }

    if (!recropAction) return;
    startRecropTransition(async () => {
      try {
        const result = await recropAction(entityId, crop);
        if (!result.success || !result.imageUrl) {
          throw new Error(result.error || result.message || `Failed to update ${entityType} image.`);
        }
        const timestampedUrl = timestamped(result.imageUrl);
        setCurrentImageUrl(timestampedUrl);
        setCropRequest(null);
        setIsEditing(false);
        toast.success(t('profile.imageUpload.recropSuccess', 'Mark updated.'));
        onImageChange?.(timestampedUrl, currentWideUrl);
      } catch (err: any) {
        handleError(err, t('profile.imageUpload.recropError', 'Failed to update the mark.'));
      }
    });
  };

  const handleDeleteImageClick = () => {
    if (!currentImageUrl) return;
    setIsDeleteDialogOpen(true);
  };

  const confirmDeleteImage = async () => {
    if (!currentImageUrl) return;

    startDeleteTransition(async () => {
      try {
        const result = await deleteAction(entityId);
        if (result.success) {
          setCurrentImageUrl(null);
          setIsEditing(false);
          toast.success(result.message || t('profile.imageUpload.deleteSuccess', `${entityType === 'client' ? 'Logo' : 'Avatar'} deleted successfully.`));

          // Notify parent component if callback provided
          if (onImageChange) {
            onImageChange(null);
          }
        } else {
          throw new Error(result.error || result.message || `Failed to delete ${entityType} image.`);
        }
      } catch (err: any) {
        handleError(err, `Failed to delete ${entityType} image.`);
      } finally {
        setIsDeleteDialogOpen(false);
      }
    });
  };

  const handleLinkDocumentId = async (documentId: string) => {
    if (!linkDocumentAsAvatar) return;
    startLinkTransition(async () => {
      try {
        const result = await linkDocumentAsAvatar({
          entityType,
          entityId,
          documentId,
        });

        if (result.success) {
          // Update image URL if provided
          if (result.imageUrl) {
            const timestamp = Date.now();
            const timestampedUrl = `${result.imageUrl}${result.imageUrl.includes('?') ? '&' : '?'}t=${timestamp}`;

            setCurrentImageUrl(timestampedUrl);

            // Notify parent component if callback provided
            if (onImageChange) {
              onImageChange(timestampedUrl);
            }
          }

          setIsEditing(false);
          setIsDocumentSelectorOpen(false);

          toast.success(
            `${entityType === 'client' || entityType === 'tenant' ? 'Logo' : 'Avatar'} linked successfully`
          );
        } else {
          throw new Error(result.error || result.message || 'Failed to link document');
        }
      } catch (err: any) {
        handleError(err, `Failed to link document as ${entityType} image.`);
      }
    });
  };

  const renderAvatar = () => {
    // A wordmark in an 'auto' slot renders whole at the avatar's height: the
    // stored wide variant when there is one, else an image that measured wide.
    // Marks and initials fall through to the circle below.
    const wideSrc = previewUrl
      ? (isWideImage ? previewUrl : null)
      : (currentWideUrl ?? (isWideImage ? displayUrl : null));
    if (previewShape === 'auto' && wideSrc) {
      return (
        <img
          src={wideSrc}
          alt={entityName}
          className={`${WIDE_FRAME_CLASS[size]} block w-auto shrink-0 rounded-md object-contain`}
          data-automation-id={`${entityType}-image-wide-preview`}
        />
      );
    }

    // Logo slots preview uncropped: the avatar frame covers-and-crops, which is
    // not what these images do where they are actually rendered.
    if (previewShape === 'square' || previewShape === 'rect') {
      const frame = previewShape === 'rect'
        ? 'h-20 w-56 rounded-md'
        : 'h-20 w-20 rounded-full';
      return (
        <div
          className={`flex ${frame} items-center justify-center overflow-hidden border border-dashed border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] p-2`}
          data-automation-id={`${entityType}-image-${previewShape}-preview`}
        >
          {displayUrl ? (
            <img src={displayUrl} alt={entityName} className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="truncate px-1 text-xs text-[rgb(var(--color-text-400))]">{entityName}</span>
          )}
        </div>
      );
    }

    if (entityType === 'client') {
      return (
        <ClientAvatar
          clientId={entityId}
          clientName={entityName}
          logoUrl={displayUrl}
          size={size}
        />
      );
    } else {
      return (
        <UserAvatar
          userId={entityId}
          userName={entityName}
          avatarUrl={displayUrl}
          size={size}
        />
      );
    }
  };

  return (
    <div className={`flex flex-col ${className || ''}`}>
      <div className="flex items-start space-x-4">
        {/* Avatar with Edit Button */}
        <div className="relative">
          {renderAvatar()}
          {canModifyImage && !isEditing && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              disabled={isPendingUpload || isPendingDelete}
              className="absolute bottom-0 right-0 mb-[-4px] mr-[-4px] text-gray-700 p-1 rounded-full hover:bg-[rgb(var(--color-primary-100))] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[rgb(var(--color-primary-100))] transition-colors"
              aria-label={`Edit ${entityType} image`}
              data-automation-id={`edit-${entityType}-image-button`}
            >
              <Pen className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Edit Controls */}
        {canModifyImage && isEditing && (
          <div className="flex flex-col space-y-1">
            <div className="flex flex-row space-x-2 items-center">
              {/* Upload Button */}
              <Button
                id={`upload-${entityType}-image-button`}
                type="button"
                variant="soft"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isPendingUpload || isPendingDelete || isPendingLink}
                className="w-fit"
                data-automation-id={`upload-${entityType}-image-button`}
              >
                {isPendingUpload ? (
                  <LoadingIndicator
                    spinnerProps={{ size: "sm" }}
                    text={(entityType === 'client' || entityType === 'tenant')
                      ? t('profile.imageUpload.uploadingLogo', 'Uploading Logo...')
                      : t('profile.imageUpload.uploadingAvatar', 'Uploading Avatar...')
                    }
                    className="mr-2"
                  />
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    {(entityType === 'client' || entityType === 'tenant')
                      ? t('profile.imageUpload.uploadLogo', 'Upload Logo')
                      : t('profile.imageUpload.uploadAvatar', 'Upload Avatar')
                    }
                  </>
                )}
              </Button>

              {/* Link Document Button */}
              {linkDocumentAsAvatar && renderDocumentSelector && (
                <Button
                  id={`link-document-${entityType}-image-button`}
                  type="button"
                  variant="soft"
                  size="sm"
                  onClick={() => setIsDocumentSelectorOpen(true)}
                  disabled={isPendingUpload || isPendingDelete || isPendingLink}
                  className="w-fit"
                  data-automation-id={`link-document-${entityType}-image-button`}
                >
                  {isPendingLink ? (
                    <LoadingIndicator
                      spinnerProps={{ size: "sm" }}
                      text={t('profile.imageUpload.linking', 'Linking...')}
                      className="mr-2"
                    />
                  ) : (
                    <>
                      <Link className="mr-2 h-4 w-4" />
                      {t('profile.imageUpload.linkDocument', 'Link Document')}
                    </>
                  )}
                </Button>
              )}

              {/* Adjust mark: re-cut the square from the stored wordmark */}
              {recropAction && currentWideUrl && (
                <Button
                  id={`recrop-${entityType}-image-button`}
                  type="button"
                  variant="soft"
                  size="sm"
                  onClick={() => setCropRequest({ imageUrl: currentWideUrl })}
                  disabled={isPendingUpload || isPendingDelete || isPendingLink || isPendingRecrop}
                  className="w-fit"
                  data-automation-id={`recrop-${entityType}-image-button`}
                >
                  <Crop className="mr-2 h-4 w-4" />
                  {currentImageUrl
                    ? t('profile.imageUpload.adjustMark', 'Adjust mark')
                    : t('profile.imageUpload.cropFromWide', 'Crop from wide logo')}
                </Button>
              )}

              <input
                type="file"
                accept={accept}
                onChange={handleImageUpload}
                disabled={isPendingUpload || isPendingDelete || isPendingLink}
                className="hidden"
                ref={fileInputRef}
                data-automation-id={`${entityType}-image-file-input`}
              />
              
              {/* Delete Button - only shown if there's an image */}
              {currentImageUrl && (
                <Button
                  id={`delete-${entityType}-image-button`}
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={handleDeleteImageClick}
                  disabled={isPendingDelete || isPendingUpload || isPendingLink}
                  className="w-fit"
                  data-automation-id={`delete-${entityType}-image-button`}
                >
                  {isPendingDelete ? (
                    <LoadingIndicator
                      spinnerProps={{ size: "sm" }}
                      text={t('profile.imageUpload.deleting', 'Deleting...')}
                      className="mr-2"
                    />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" />
                  )}
                  {t('profile.imageUpload.delete', 'Delete')}
                </Button>
              )}

              {/* Cancel Button */}
              <Button
                id={`cancel-${entityType}-image-edit-button`}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsEditing(false)}
                disabled={isPendingUpload || isPendingDelete || isPendingLink}
                className="w-fit"
                data-automation-id={`cancel-${entityType}-image-edit-button`}
              >
                {tCore('common.cancel', 'Cancel')}
              </Button>
            </div>
            
            {/* Help Text */}
            <p className="text-xs text-gray-500 pl-1">
              Max 2MB (PNG, JPG, GIF)
            </p>
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmationDialog
        id={`delete-${entityType}-image-confirmation-dialog`}
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={confirmDeleteImage}
        title={entityType === 'client'
          ? t('profile.imageUpload.deleteLogo', 'Delete Client Logo')
          : t('profile.imageUpload.deleteProfilePicture', 'Delete Profile Picture')
        }
        message={entityType === 'client'
          ? t('profile.imageUpload.deleteLogoConfirm', `Are you sure you want to delete the logo for "${entityName}"? This action cannot be undone.`)
          : t('profile.imageUpload.deleteAvatarConfirm', `Are you sure you want to delete the profile picture for "${entityName}"? This action cannot be undone.`)
        }
        confirmLabel={tCore('common.delete', 'Delete')}
        cancelLabel={tCore('common.cancel', 'Cancel')}
        isConfirming={isPendingDelete}
      />

      <ImageCropDialog
        id={`${entityType}-image-crop-dialog`}
        isOpen={cropRequest !== null}
        imageUrl={cropRequest?.imageUrl ?? null}
        imageName={entityName}
        onClose={closeCropDialog}
        onConfirm={handleCropConfirm}
        isConfirming={isPendingRecrop}
        helpText={cropHelpText}
      />

      {/* Document Selector Modal */}
      {renderDocumentSelector?.({
        isOpen: isDocumentSelectorOpen,
        onClose: () => setIsDocumentSelectorOpen(false),
        onSelectDocumentId: handleLinkDocumentId,
        entityType,
        entityId,
      })}
    </div>
  );
};

export default EntityImageUpload;
