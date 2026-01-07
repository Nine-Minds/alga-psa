'use client';

import React, { ReactNode, useState, useRef, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Cross2Icon } from '@radix-ui/react-icons';
import { useAutomationIdAndRegister } from '../../types/ui-reflection/useAutomationIdAndRegister';
import { DialogComponent, ButtonComponent, AutomationProps } from '../../types/ui-reflection/types';
import { ReflectionContainer } from '../../types/ui-reflection/ReflectionContainer';

interface GenericDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Unique identifier for UI reflection system */
  id?: string; // Made required since it's needed for reflection registration
  /** Whether the dialog should be draggable */
  draggable?: boolean;
  /** Initial position (defaults to centered) */
  initialPosition?: { x?: number; y?: number };
  /** Whether to constrain dragging within viewport */
  constrainToViewport?: boolean;
}

const GenericDialog: React.FC<GenericDialogProps & AutomationProps> = ({ 
  isOpen, 
  onClose, 
  title, 
  children,
  id = 'dialog',
  draggable = true,
  initialPosition,
  constrainToViewport = true
}) => {
  // Register dialog with UI reflection system
  const { automationIdProps: dialogProps } = useAutomationIdAndRegister<DialogComponent>({
    id,
    type: 'dialog',
    title,
    open: isOpen
  });

  // Register close button
  const { automationIdProps: closeButtonProps } = useAutomationIdAndRegister<ButtonComponent>({
    id: `${id}-close`,
    type: 'button',
    label: 'Close Dialog',
  });

  const dialogRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dialogSize, setDialogSize] = useState({ width: 0, height: 0 });

  // Reset position when dialog opens
  useEffect(() => {
    if (isOpen) {
      if (initialPosition) {
        setPosition({
          x: initialPosition.x || 0,
          y: initialPosition.y || 0
        });
      } else {
        setPosition({ x: 0, y: 0 });
      }
    }
  }, [isOpen, initialPosition]);

  // Update dialog size for viewport constraints
  useEffect(() => {
    if (dialogRef.current && isOpen) {
      const rect = dialogRef.current.getBoundingClientRect();
      setDialogSize({ width: rect.width, height: rect.height });
    }
  }, [isOpen]);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!draggable) return;
    
    // Only start dragging if clicking on the header/title area
    const target = e.target as HTMLElement;
    const isHeaderArea = target.closest('[data-drag-handle]');
    if (!isHeaderArea) return;

    setIsDragging(true);
    setDragStart({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    });
    e.preventDefault();
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging || !draggable) return;

    let newX = e.clientX - dragStart.x;
    let newY = e.clientY - dragStart.y;

    // Constrain to viewport if enabled
    if (constrainToViewport && dialogRef.current) {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      // Calculate boundaries - allow some portion of dialog to go outside viewport
      // but keep at least 100px visible
      const minVisibleArea = 100;
      const minX = -(dialogSize.width / 2 - minVisibleArea);
      const maxX = viewportWidth - (dialogSize.width / 2 + minVisibleArea);
      const minY = -(dialogSize.height / 2 - minVisibleArea);
      const maxY = viewportHeight - (dialogSize.height / 2 + minVisibleArea);

      newX = Math.max(minX, Math.min(maxX, newX));
      newY = Math.max(minY, Math.min(maxY, newY));
    }

    setPosition({ x: newX, y: newY });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Add global mouse event listeners for dragging
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, dragStart]);

  const dialogStyle: React.CSSProperties = {
    transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px))`,
    cursor: isDragging ? 'move' : 'auto',
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content 
          ref={dialogRef}
          {...dialogProps}
          className="fixed top-1/2 left-1/2 bg-white rounded-lg shadow-lg w-full max-w-md focus-within:ring-2 focus-within:ring-purple-100 focus-within:ring-offset-2"
          style={dialogStyle}
          onMouseDown={handleMouseDown}
        >
          <div 
            data-drag-handle
            className={`${draggable ? 'cursor-move' : ''} p-6 pb-2`}
          >
            <Dialog.Title className="text-xl font-semibold select-none">{title}</Dialog.Title>
          </div>
          <div className="px-6 pb-6">
            <ReflectionContainer id={`${id}-content`} label={title}>
              {children}
            </ReflectionContainer>
          </div>
          <Dialog.Close asChild>
            <button
              {...closeButtonProps}
              className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 rounded-sm focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-500))] focus:ring-offset-2"
              aria-label="Close"
            >
              <Cross2Icon />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default GenericDialog;
