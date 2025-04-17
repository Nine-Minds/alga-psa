'use client';

import * as React from 'react';
import { useState, useRef, useTransition } from 'react';
import { toast } from 'react-hot-toast';
import { Pen, Loader2, Trash2, Upload } from 'lucide-react';
import { Button } from 'server/src/components/ui/Button';
import UserAvatar from 'server/src/components/settings/general/UserAvatar';
import CompanyAvatar from 'server/src/components/ui/CompanyAvatar';
import { EntityType } from 'server/src/lib/services/EntityImageService';

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
  const [isEditing, setIsEditing] = useState(false);
  const [isPendingUpload, startUploadTransition] = useTransition();
  const [isPendingDelete, startDeleteTransition] = useTransition();
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(imageUrl);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Update local state when prop changes
  React.useEffect(() => {
    setCurrentImageUrl(imageUrl);
  }, [imageUrl]);

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
    formData.append(entityType === 'company' ? 'logo' : 'avatar', file);

    // Create a local object URL for immediate display
    const localImageUrl = URL.createObjectURL(file);
    setCurrentImageUrl(localImageUrl);

    startUploadTransition(async () => {
      try {
        const result = await uploadAction(entityId, formData);
        
        if (result.success) {
          // Revoke the temporary object URL to free up memory
          URL.revokeObjectURL(localImageUrl);
          
          const serverImageUrl = result.imageUrl || null;
          
          if (serverImageUrl) {
            const timestamp = Date.now();
            const timestampedUrl = `${serverImageUrl}${serverImageUrl.includes('?') ? '&' : '?'}t=${timestamp}`;
            
            console.log(`EntityImageUpload: Setting image URL to: ${timestampedUrl}`);
            
            if (onImageChange) {
              onImageChange(null);
            }
            
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
          URL.revokeObjectURL(localImageUrl);
          setCurrentImageUrl(imageUrl);
          throw new Error(result.error || `Failed to upload ${entityType} image.`);
        }
      } catch (err: any) {
        console.error(`Failed to upload ${entityType} image:`, err);
        toast.error(err.message || `Failed to upload ${entityType} image.`);
        URL.revokeObjectURL(localImageUrl);
        setCurrentImageUrl(imageUrl);
        // Reset the file input
        e.target.value = '';
      }
    });
  };

  const handleDeleteImage = () => {
    if (!currentImageUrl) return;

    startDeleteTransition(async () => {
      try {
        const result = await deleteAction(entityId);
        if (result.success) {
          setCurrentImageUrl(null);
          setIsEditing(false);
          toast.success(result.message || `${entityType} image deleted successfully.`);
          
          // Notify parent component if callback provided
          if (onImageChange) {
            onImageChange(null);
          }
        } else {
          throw new Error(result.error || `Failed to delete ${entityType} image.`);
        }
      } catch (err: any) {
        console.error(`Failed to delete ${entityType} image:`, err);
        toast.error(err.message || `Failed to delete ${entityType} image.`);
      }
    });
  };

  const renderAvatar = () => {
    if (entityType === 'company') {
      return (
        <CompanyAvatar
          companyId={entityId}
          companyName={entityName}
          logoUrl={currentImageUrl}
          size={size}
        />
      );
    } else {
      return (
        <UserAvatar
          userId={entityId}
          userName={entityName}
          avatarUrl={currentImageUrl}
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
                {isPendingUpload ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Upload {entityType === 'company' ? 'Logo' : 'Avatar'}
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
                  onClick={handleDeleteImage}
                  disabled={isPendingDelete || isPendingUpload}
                  className="w-fit"
                  data-automation-id={`delete-${entityType}-image-button`}
                >
                  {isPendingDelete ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                  Delete
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
                Cancel
              </Button>
            </div>
            
            {/* Help Text */}
            <p className="text-xs text-gray-500 pl-1">
              Max 2MB (PNG, JPG, GIF)
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default EntityImageUpload;
