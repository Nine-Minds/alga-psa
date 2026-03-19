'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { DraggableProvided } from '@hello-pangea/dnd';
import { createPortal } from 'react-dom';

export type PaletteTooltipItem = {
  id: string;
  label: string;
  description: string;
  type: string;
  actionId?: string;
  actionVersion?: number;
  groupKey?: string;
  iconToken?: string;
  tileKind?: 'core-object' | 'transform' | 'app' | 'ai';
};

const PaletteTooltip: React.FC<{
  label: string;
  description: string;
  triggerRef: React.RefObject<HTMLDivElement | null>;
  isHovered: boolean;
}> = ({ label, description, triggerRef, isHovered }) => {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isHovered && triggerRef.current) {
      timeoutRef.current = setTimeout(() => {
        if (triggerRef.current) {
          const rect = triggerRef.current.getBoundingClientRect();
          setPosition({
            top: rect.top + rect.height / 2,
            left: rect.right + 8,
          });
          setVisible(true);
        }
      }, 500);
    } else {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setVisible(false);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [isHovered, triggerRef]);

  if (!visible || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed px-2.5 py-1.5 rounded-md shadow-lg bg-gray-900 text-white text-xs whitespace-nowrap pointer-events-none"
      style={{
        top: position.top,
        left: position.left,
        transform: 'translateY(-50%)',
        zIndex: 99999,
      }}
    >
      <div className="font-medium">{label}</div>
      <div className="text-gray-400 text-[10px]">{description}</div>
      <div
        className="absolute border-4 border-transparent border-r-gray-900"
        style={{ right: '100%', top: '50%', transform: 'translateY(-50%)' }}
      />
    </div>,
    document.body
  );
};

export const PaletteItemWithTooltip: React.FC<{
  item: PaletteTooltipItem;
  icon: React.ReactNode;
  isDragging: boolean;
  provided: DraggableProvided;
  disabled?: boolean;
  onClick: () => void;
}> = ({ item, icon, isDragging, provided, disabled = false, onClick }) => {
  const [isHovered, setIsHovered] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={(node) => {
        provided.innerRef(node);
        (triggerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }}
      {...provided.draggableProps}
      {...(disabled ? {} : provided.dragHandleProps)}
      className={`
        group relative flex items-center justify-center
        w-10 h-10 rounded-lg border cursor-grab
        transition-all duration-150
        ${disabled ? 'cursor-not-allowed opacity-50' : ''}
        ${isDragging
          ? 'shadow-lg ring-2 ring-primary-400 bg-primary-50 border-primary-300 z-50'
          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
        }
      `}
      id={`workflow-designer-add-${item.id}`}
      data-testid={`palette-item-${item.id}`}
      role="button"
      aria-disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        if (disabled) return;
        onClick();
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <span className="text-gray-500 group-hover:text-gray-700">{icon}</span>
      <PaletteTooltip
        label={item.label}
        description={item.description}
        triggerRef={triggerRef}
        isHovered={isHovered && !isDragging}
      />
    </div>
  );
};
