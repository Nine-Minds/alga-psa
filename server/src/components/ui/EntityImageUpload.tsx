'use client';

import * as React from 'react';
import { useState, useRef, useTransition } from 'react';
import { toast } from 'react-hot-toast';
import { Pen, Trash2, Upload } from 'lucide-react';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';
import { Button } from 'server/src/components/ui/Button';
import UserAvatar from 'server/src/components/ui/UserAvatar';
import ClientAvatar from 'server/src/components/ui/ClientAvatar';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { EntityType } from 'server/src/lib/services/EntityImageService';
import { useTranslation } from 'server/src/lib/i18n/client';

interface EntityImageUploadProps {
  entityType: EntityType;
  entityId: string;
  entityName: string;
  imageUrl: string | null;
  onImageChange?: (newImageUrl: string | null) => void;
  uploadAction: (entityId: string, formData: FormData) => Promise<{
    success: boolean;
    message?: string;
    imageUrl?: string | null;
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
}

const EntityImageUpload: React.FC<EntityImageUploadProps> = ({
  entityType,
  entityId,
  entityName,
  imageUrl,
  onImageChange,
  uploadAction,
  deleteAction,
  userType,
  userEntityId,
  canModify = true,
  className,
  size = 'lg',
}) => {
  const { t } = useTranslation('clientPortal');
  const [isEditing, setIsEditing] = useState(false);
  const [isPendingUpload, startUploadTransition] = useTransition();
  const [isPendingDelete, startDeleteTransition] = useTransition();
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(imageUrl);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Update local state when prop changes
  React.useEffect(() => {
    setCurrentImageUrl(imageUrl);
    // Clear any preview when the actual image changes
    setPreviewUrl(null);
  }, [imageUrl]);

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

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
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

    const formData = new FormData();
    formData.append((entityType === 'client' || entityType === 'tenant') ? 'logo' : 'avatar', file);

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
          
          if (serverImageUrl) {
            const timestamp = Date.now();
            const timestampedUrl = `${serverImageUrl}${serverImageUrl.includes('?') ? '&' : '?'}t=${timestamp}`;
            
            console.log(`EntityImageUpload: Setting image URL to: ${timestampedUrl}`);
            
            // Clear the preview first
            setPreviewUrl(null);
            
            if (onImageChange) {
              onImageChange(null);
            }
            
            // Small delay to allow for transition effects
            setTimeout(() => {
              setCurrentImageUrl(timestampedUrl);
              
              if (onImageChange) {
                onImageChange(timestampedUrl);
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
        console.error(`[EntityImageUpload] Failed to upload ${entityType} image:`, {
          operation: 'handleImageUpload',
          entityType,
          entityId,
          entityName,
          errorMessage: err.message || 'Unknown error',
          errorStack: err.stack,
          errorName: err.name
        });
        toast.error(err.message || `Failed to upload ${entityType} image.`);
        URL.revokeObjectURL(localImageUrl);
        setCurrentImageUrl(imageUrl);
        // Reset the file input
        e.target.value = '';
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
        console.error(`[EntityImageUpload] Failed to delete ${entityType} image:`, {
          operation: 'confirmDeleteImage',
          entityType,
          entityId,
          entityName,
          errorMessage: err.message || 'Unknown error',
          errorStack: err.stack,
          errorName: err.name
        });
        toast.error(err.message || `Failed to delete ${entityType} image.`);
      } finally {
        setIsDeleteDialogOpen(false);
      }
    });
  };

  const renderAvatar = () => {
    // Use the preview URL if available, otherwise use the current image URL
    const displayUrl = previewUrl || currentImageUrl;
    
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
              className="absolute bottom-0 right-0 mb-[-4px] mr-[-4px] text-gray-700 p-1 rounded-full hover:bg-purple-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-100 transition-colors"
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
                disabled={isPendingUpload || isPendingDelete}
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
              
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                disabled={isPendingUpload || isPendingDelete}
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
                  disabled={isPendingDelete || isPendingUpload}
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
                disabled={isPendingUpload || isPendingDelete}
                className="w-fit"
                data-automation-id={`cancel-${entityType}-image-edit-button`}
              >
                {t('common.cancel', 'Cancel')}
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
        confirmLabel={t('common.delete', 'Delete')}
        cancelLabel={t('common.cancel', 'Cancel')}
        isConfirming={isPendingDelete}
      />
    </div>
  );
};

export default EntityImageUpload;
