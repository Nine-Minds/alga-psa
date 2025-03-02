import React from 'react';
import { useReactFlow } from 'reactflow';

/**
 * Zoom controls component for workflow visualization
 * Provides zoom in, zoom out, and fit view buttons
 */
export function ZoomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  return (
    <div className="zoom-controls flex flex-col bg-white rounded-md shadow-sm border border-gray-200 overflow-hidden">
      <button
        className="p-2 hover:bg-gray-100 border-b border-gray-200 text-gray-700"
        onClick={() => zoomIn()}
        title="Zoom In"
        id="workflow-zoom-in"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
          <line x1="11" y1="8" x2="11" y2="14" />
          <line x1="8" y1="11" x2="14" y2="11" />
        </svg>
      </button>
      
      <button
        className="p-2 hover:bg-gray-100 border-b border-gray-200 text-gray-700"
        onClick={() => zoomOut()}
        title="Zoom Out"
        id="workflow-zoom-out"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
          <line x1="8" y1="11" x2="14" y2="11" />
        </svg>
      </button>
      
      <button
        className="p-2 hover:bg-gray-100 text-gray-700"
        onClick={() => fitView({ padding: 0.2 })}
        title="Fit View"
        id="workflow-fit-view"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M15 3h6v6" />
          <path d="M9 21H3v-6" />
          <path d="M21 3l-7 7" />
          <path d="M3 21l7-7" />
        </svg>
      </button>
    </div>
  );
}

export default ZoomControls;