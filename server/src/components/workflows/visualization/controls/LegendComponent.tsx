import React, { useState } from 'react';

/**
 * Legend component for workflow visualization
 * Provides a legend explaining the different node and edge types
 */
export function LegendComponent() {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="legend-component absolute bottom-4 right-4 bg-white rounded-md shadow-md border border-gray-200 overflow-hidden">
      <div 
        className="legend-header p-2 bg-gray-50 border-b border-gray-200 flex justify-between items-center cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
        id="workflow-legend-header"
      >
        <span className="text-sm font-semibold text-gray-700">Legend</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
      
      {isExpanded && (
        <div className="legend-content p-3">
          <div className="text-xs font-semibold text-gray-500 mb-2">Control Flow Elements</div>
          
          <div className="grid grid-cols-1 gap-2 mb-4">
            <div className="flex items-center">
              <div className="w-4 h-4 rounded-sm border border-gray-300 bg-white mr-2"></div>
              <span className="text-xs text-gray-700">Action</span>
            </div>
            
            <div className="flex items-center">
              <div className="w-4 h-4 rounded-sm border-purple-300 bg-purple-50 mr-2"></div>
              <span className="text-xs text-gray-700">Event (Wait)</span>
            </div>
            
            <div className="flex items-center">
              <div className="w-4 h-4 rounded-sm border-indigo-300 bg-indigo-50 mr-2"></div>
              <span className="text-xs text-gray-700">Event (Emit)</span>
            </div>
            
            <div className="flex items-center">
              <div className="w-4 h-4 rounded-sm border-orange-300 bg-orange-50 mr-2"></div>
              <span className="text-xs text-gray-700">Conditional</span>
            </div>
            
            <div className="flex items-center">
              <div className="w-4 h-4 rounded-sm border-teal-300 bg-teal-50 mr-2"></div>
              <span className="text-xs text-gray-700">Loop</span>
            </div>
            
            <div className="flex items-center">
              <div className="w-4 h-4 rounded-sm border-violet-300 bg-violet-50 mr-2"></div>
              <span className="text-xs text-gray-700">Parallel</span>
            </div>
          </div>
          
          <div className="text-xs font-semibold text-gray-500 mb-2">Node Status</div>
          
          <div className="grid grid-cols-1 gap-2 mb-4">
            <div className="flex items-center">
              <div className="w-4 h-4 rounded-sm border border-gray-300 bg-white mr-2"></div>
              <span className="text-xs text-gray-700">Default</span>
            </div>
            
            <div className="flex items-center">
              <div className="w-4 h-4 rounded-sm border-blue-500 bg-blue-50 mr-2"></div>
              <span className="text-xs text-gray-700">Active</span>
            </div>
            
            <div className="flex items-center">
              <div className="w-4 h-4 rounded-sm border-green-500 bg-green-50 mr-2"></div>
              <span className="text-xs text-gray-700">Success</span>
            </div>
            
            <div className="flex items-center">
              <div className="w-4 h-4 rounded-sm border-red-500 bg-red-50 mr-2"></div>
              <span className="text-xs text-gray-700">Error</span>
            </div>
            
            <div className="flex items-center">
              <div className="w-4 h-4 rounded-sm border-yellow-500 bg-yellow-50 mr-2"></div>
              <span className="text-xs text-gray-700">Warning</span>
            </div>
          </div>
          
          <div className="text-xs font-semibold text-gray-500 mb-2">Control Flow Types</div>
          
          <div className="grid grid-cols-1 gap-2">
            <div className="flex items-center">
              <div className="w-6 h-0.5 bg-gray-600 mr-2"></div>
              <span className="text-xs text-gray-700">Sequential Flow</span>
            </div>
            
            <div className="flex items-center">
              <div className="w-6 h-0.5 bg-blue-500 mr-2" style={{ borderTopStyle: 'dashed' }}></div>
              <span className="text-xs text-gray-700">Conditional Branch</span>
            </div>
            
            <div className="flex items-center">
              <div className="w-6 h-0.5 bg-green-500 mr-2" style={{ borderTopStyle: 'dashed' }}></div>
              <span className="text-xs text-gray-700">True Branch</span>
            </div>
            
            <div className="flex items-center">
              <div className="w-6 h-0.5 bg-red-500 mr-2" style={{ borderTopStyle: 'dashed' }}></div>
              <span className="text-xs text-gray-700">False Branch</span>
            </div>
            
            <div className="flex items-center">
              <div className="w-6 h-0.5 bg-red-500 mr-2" style={{ borderTopStyle: 'dashed' }}></div>
              <span className="text-xs text-gray-700">Loop</span>
            </div>
            
            <div className="flex items-center">
              <div className="w-6 h-0.5 bg-green-500 mr-2"></div>
              <span className="text-xs text-gray-700">Parallel Execution</span>
            </div>
            
            <div className="flex items-center">
              <div className="w-6 h-0.5 bg-blue-500 animate-pulse mr-2"></div>
              <span className="text-xs text-gray-700">Active Flow</span>
            </div>
            
            <div className="flex items-center mt-2">
              <svg width="24" height="24" viewBox="0 0 24 24" className="mr-1">
                <path
                  d="M12 2L12 18M12 18L6 12M12 18L18 12"
                  fill="none"
                  stroke="#666"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="text-xs text-gray-700">Flow Direction (Top to Bottom)</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LegendComponent;