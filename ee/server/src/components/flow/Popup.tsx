// src/components/Popup.tsx
import React, { useState, useRef, useEffect } from 'react';
import styles from './Popup.module.css';

interface PopupProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Whether the popup should be draggable */
  draggable?: boolean;
  /** Initial position (defaults to centered) */
  initialPosition?: { x?: number; y?: number };
  /** Whether to constrain dragging within viewport */
  constrainToViewport?: boolean;
}

const Popup: React.FC<PopupProps> = ({ 
  isOpen, 
  onClose, 
  title, 
  children,
  draggable = true,
  initialPosition,
  constrainToViewport = true
}) => {
  const popupRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [popupSize, setPopupSize] = useState({ width: 0, height: 0 });

  // Reset position when popup opens
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

  // Update popup size for viewport constraints
  useEffect(() => {
    if (popupRef.current && isOpen) {
      const rect = popupRef.current.getBoundingClientRect();
      setPopupSize({ width: rect.width, height: rect.height });
    }
  }, [isOpen]);

  const handleMouseDown = (e: React.MouseEvent<HTMLHeadingElement>) => {
    if (!draggable) return;

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
    if (constrainToViewport && popupRef.current) {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      // Calculate boundaries - allow some portion of popup to go outside viewport
      // but keep at least 100px visible
      const minVisibleArea = 100;
      const minX = -(viewportWidth / 2 - minVisibleArea);
      const maxX = viewportWidth / 2 - minVisibleArea;
      const minY = -(viewportHeight / 2 - minVisibleArea);
      const maxY = viewportHeight / 2 - minVisibleArea;

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

  if (!isOpen) return null;

  const popupStyle: React.CSSProperties = {
    transform: `translate(${position.x}px, ${position.y}px)`,
    cursor: isDragging ? 'move' : 'auto',
  };

  return (
    <div className={styles.overlay}>
      <div 
        ref={popupRef}
        className={styles.popup} 
        style={popupStyle}
      >
        <h2 
          className={`${styles.title} ${draggable ? styles.draggableTitle : ''}`} 
          onMouseDown={handleMouseDown}
          style={{ cursor: draggable ? 'move' : 'default', userSelect: 'none' }}
        >
          {title}
        </h2>
        <div className={styles.content}>{children}</div>
        <button className={styles.closeButton} onClick={onClose}>
          &times;
        </button>
      </div>
    </div>
  );
};

export default Popup;