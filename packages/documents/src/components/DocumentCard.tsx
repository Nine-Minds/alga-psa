'use client';

import React, { useState } from 'react';
import type { IDocument } from '@alga-psa/types';
import TextEditor, { DEFAULT_BLOCK } from '../editor/TextEditor';
import { PartialBlock } from '@blocknote/core';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { FileText, Link2, Trash2 } from 'lucide-react';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';

interface DocumentCardProps {
  id?: string;
  document: IDocument;
  onDelete?: () => void;
  onDisassociate?: () => void;
  showDisassociate?: boolean;
  onClick?: () => void;
  isContentDocument?: boolean;
}

const DocumentCard: React.FC<DocumentCardProps> = ({
  id = 'document-card',
  document,
  onDelete,
  onDisassociate,
  showDisassociate = false,
  onClick,
  isContentDocument = false
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState(document.document_name);
  const [editedContent, setEditedContent] = useState<PartialBlock[]>(DEFAULT_BLOCK);

  const handleSave = async () => {
    // Save logic here
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditedName(document.document_name);
    setEditedContent([]);
    setIsEditing(false);
  };

  const handleContentChange = (blocks: PartialBlock[]) => {
    setEditedContent(blocks);
  };

  const renderContent = () => {
    if (isEditing) {
      return (
        <div className="space-y-4">
          <Input
            data-automation-id={`${id}-name-input`}
            type="text"
            value={editedName}
            onChange={(e) => setEditedName(e.target.value)}
            className="w-full"
          />
          <TextEditor
            id={`${id}-editor`}
            initialContent={editedContent}
            onContentChange={handleContentChange}
          />
          <div className="flex justify-end space-x-2">
            <Button
              id={`${id}-save-btn`}
              data-automation-id={`${id}-save-btn`}
              onClick={handleSave}
              className="bg-green-500 hover:bg-green-600 text-white"
            >
              Save
            </Button>
            <Button
              id={`${id}-cancel-btn`}
              data-automation-id={`${id}-cancel-btn`}
              onClick={handleCancel}
              variant="outline"
            >
              Cancel
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <FileText className="w-5 h-5 text-gray-500" />
          <div>
            <h3 className="text-sm font-medium text-gray-900">{document.document_name}</h3>
            <p className="text-sm text-gray-500">
              {document.entered_at ? new Date(document.entered_at).toLocaleDateString() : 'No date'}
            </p>
          </div>
        </div>
        <div className="flex space-x-2">
          {onDelete && (
            <Button
              id={`${id}-delete-btn`}
              data-automation-id={`${id}-delete-btn`}
              onClick={onDelete}
              variant="ghost"
              className="text-red-600 hover:text-red-800"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
          {showDisassociate && onDisassociate && (
            <Button
              id={`${id}-disassociate-btn`}
              data-automation-id={`${id}-disassociate-btn`}
              onClick={onDisassociate}
              variant="ghost"
              className="text-gray-600 hover:text-gray-800"
            >
              <Link2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <ReflectionContainer id={id} label="Document Card">
      <Card
        data-automation-id={`${id}-container`}
        className={`p-4 ${onClick && !isEditing ? 'cursor-pointer hover:bg-gray-50' : ''}`}
        onClick={!isEditing && onClick ? onClick : undefined}
      >
        {renderContent()}
      </Card>
    </ReflectionContainer>
  );
};

export default DocumentCard;
