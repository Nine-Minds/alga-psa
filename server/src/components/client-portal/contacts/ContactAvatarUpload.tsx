'use client';

import * as React from 'react';
import { useState, useRef, useTransition } from 'react';
import { toast } from 'react-hot-toast';
import { Pen, Loader2, Trash2, Upload } from 'lucide-react';
import { Button } from 'server/src/components/ui/Button';
import UserAvatar from 'server/src/components/settings/general/UserAvatar';
import { uploadContactAvatar, deleteContactAvatar } from 'server/src/lib/actions/client-portal-actions/clientUserActions';

interface ContactAvatarUploadProps {
  contactId: string;
  contactName: string;
  avatarUrl: string | null;
  onAvatarChange?: (newAvatarUrl: string | null) => void;
  userType: string;
  userContactId?: string;
  className?: string;
}

const ContactAvatarUpload: React.FC<ContactAvatarUploadProps> = ({
  contactId,
  contactName,
  avatarUrl,
  onAvatarChange,
  userType,
  userContactId,
  className,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [isPendingUpload, startUploadTransition] = useTransition();
  const [isPendingDelete, startDeleteTransition] = useTransition();
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState<string | null>(avatarUrl);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Update local state when prop changes
  React.useEffect(() => {
    setCurrentAvatarUrl(avatarUrl);
  }, [avatarUrl]);

  // Determine if the current user has permission to modify this contact's avatar
  const canModifyAvatar = React.useMemo(() => {
    // Internal users can modify any contact's avatar
    if (userType === 'internal') return true;
    
    // Client users can only modify their own linked contact's avatar
    if (userType === 'client' && userContactId === contactId) return true;
    
    // Otherwise, no permission
    return false;
  }, [userType, userContactId, contactId]);

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Client-side validation
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file.');
      e.target.value = '';
      return;
    }

    // Check file size (5MB limit)
    const maxSize = 5 * 1024 * 1024; // 5MB in bytes
    if (file.size > maxSize) {
      toast.error('Image size must be less than 5MB.');
      e.target.value = '';
      return;
    }

    const formData = new FormData();
    formData.append('avatar', file);

    startUploadTransition(async () => {
      try {
        const result = await uploadContactAvatar(contactId, formData);
        if (result.success) {
          setCurrentAvatarUrl(result.imageUrl || null);
          setIsEditing(false);
          toast.success('Avatar uploaded successfully.');
          
          // Notify parent component if callback provided
          if (onAvatarChange) {
            onAvatarChange(result.imageUrl || null);
          }
        } else {
          throw new Error(result.message || 'Failed to upload avatar.');
        }
      } catch (err: any) {
        console.error('Failed to upload avatar:', err);
        toast.error(err.message || 'Failed to upload avatar.');
        // Reset the file input
        e.target.value = '';
      }
    });
  };

  const handleDeleteAvatar = () => {
    if (!currentAvatarUrl) return;

    startDeleteTransition(async () => {
      try {
        const result = await deleteContactAvatar(contactId);
        if (result.success) {
          setCurrentAvatarUrl(null);
          setIsEditing(false);
          toast.success('Avatar deleted successfully.');
          
          // Notify parent component if callback provided
          if (onAvatarChange) {
            onAvatarChange(null);
          }
        } else {
          throw new Error(result.message || 'Failed to delete avatar.');
        }
      } catch (err: any) {
        console.error('Failed to delete avatar:', err);
        toast.error(err.message || 'Failed to delete avatar.');
      }
    });
  };

  return (
    <div className={`flex flex-col ${className || ''}`}>
      <div className="flex items-start space-x-4">
        {/* Avatar with Edit Button */}
        <div className="relative">
          <UserAvatar
            userId={contactId} // Using contactId as userId for the UserAvatar component
            userName={contactName}
            avatarUrl={currentAvatarUrl}
            size="lg"
          />
          {canModifyAvatar && !isEditing && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              disabled={isPendingUpload || isPendingDelete}
              className="absolute bottom-0 right-0 mb-[-4px] mr-[-4px] text-gray-700 p-1 rounded-full hover:bg-purple-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-100 transition-colors"
              aria-label="Edit avatar"
              data-automation-id="edit-contact-avatar-button"
            >
              <Pen className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Edit Controls - Only shown if user has permission */}
        {canModifyAvatar && isEditing && (
          <div className="flex flex-col space-y-1">
            <div className="flex flex-row space-x-2 items-center">
              {/* Upload Button */}
              <Button
                id="upload-contact-avatar-button"
                type="button"
                variant="soft"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isPendingUpload || isPendingDelete}
                className="w-fit"
                data-automation-id="upload-contact-avatar-button"
              >
                {isPendingUpload ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Upload Avatar
              </Button>
              
              <input
                type="file"
                accept="image/*"
                onChange={handleAvatarUpload}
                disabled={isPendingUpload || isPendingDelete}
                className="hidden"
                ref={fileInputRef}
                data-automation-id="contact-avatar-file-input"
              />
              
              {/* Delete Button - only shown if there's an avatar */}
              {currentAvatarUrl && (
                <Button
                  id="delete-contact-avatar-button"
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={handleDeleteAvatar}
                  disabled={isPendingDelete || isPendingUpload}
                  className="w-fit"
                  data-automation-id="delete-contact-avatar-button"
                >
                  {isPendingDelete ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                  Delete
                </Button>
              )}
              
              {/* Cancel Button */}
              <Button
                id="cancel-contact-avatar-edit-button"
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsEditing(false)}
                disabled={isPendingUpload || isPendingDelete}
                className="w-fit"
                data-automation-id="cancel-contact-avatar-edit-button"
              >
                Cancel
              </Button>
            </div>
            
            {/* Help Text */}
            <p className="text-xs text-gray-500 pl-1">
              Max 5MB (PNG, JPG, GIF)
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ContactAvatarUpload;