import React, { forwardRef, useLayoutEffect, useEffect, useRef } from 'react';

interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  ({ label, onChange, className, value = '', ...props }, ref) => {
    // Keep track of whether initial adjustment has been done
    const initialAdjustmentDone = useRef(false);

    const adjustHeight = (element: HTMLTextAreaElement) => {
      // Force a reflow
      void element.offsetHeight;
      
      // Reset height to get proper scrollHeight
      element.style.height = 'auto';
      
      // Set new height
      const newHeight = element.scrollHeight;
      element.style.height = `${newHeight}px`;
    };

    // Immediate mount effect for initial content
    useEffect(() => {
      if (!initialAdjustmentDone.current && ref && 'current' in ref && ref.current) {
        const textarea = ref.current;
        
        // Force immediate height adjustment
        const adjustInitialHeight = () => {
          // Force a reflow first
          void textarea.offsetHeight;
          textarea.style.height = 'auto';
          const scrollHeight = textarea.scrollHeight;
          textarea.style.height = `${scrollHeight}px`;
          initialAdjustmentDone.current = true;
        };

        // Run adjustment immediately and after a small delay
        adjustInitialHeight();
        setTimeout(adjustInitialHeight, 0);
      }
    }, []);

    // Handle subsequent value changes
    useLayoutEffect(() => {
      if (ref && 'current' in ref && ref.current) {
        adjustHeight(ref.current);
      }
    }, [value]);

    const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      adjustHeight(e.target);
      
      if (onChange) {
        onChange(e);
      }
    };

    return (
      <div className="mb-4">
        {label && (
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          rows={1}
          className={`w-full px-3 py-[0.4375rem] border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none overflow-hidden whitespace-pre-wrap ${className}`}
          onChange={handleInput}
          value={value}
          {...props}
        />
      </div>
    );
  }
);

TextArea.displayName = 'TextArea';
