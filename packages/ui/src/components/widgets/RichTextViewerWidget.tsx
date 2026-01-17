'use client';

import React, { useState, useEffect } from 'react';
import { WidgetProps } from '@rjsf/utils';
import { useCreateBlockNote } from "@blocknote/react";
import { PartialBlock } from '@blocknote/core';
import RichTextViewer from '../../editor/RichTextViewer'; // Adjusted path

// Define options if any might be needed in the future, for consistency
interface RichTextViewerWidgetOptions {
  // e.g., className for the RichTextViewer's container
  className?: string;
}

interface CustomRichTextViewerWidgetProps extends WidgetProps {
  options: RichTextViewerWidgetOptions & WidgetProps['options'];
}

const RichTextViewerWidget = ({
  value, // Expected to be a Markdown string
  id,
  options,
  label,
}: CustomRichTextViewerWidgetProps) => {
  const [blocks, setBlocks] = useState<PartialBlock[] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Create a BlockNote editor instance to use its Markdown parsing utility.
  // This editor instance is not rendered directly by this widget.
  const editor = useCreateBlockNote();

  useEffect(() => {
    if (typeof value === 'string' && editor) {
      setIsLoading(true);
      const parseMarkdown = async () => {
        try {
          // Pre-process the markdown to respect newlines
          const processedValue = value.replace(/\n/g, '  \n');
          const parsedBlocks = await editor.tryParseMarkdownToBlocks(processedValue);
          setBlocks(parsedBlocks);
        } catch (error) {
          console.error("Error parsing Markdown to blocks:", error);
          // Fallback: treat the value as plain text if parsing fails
          // Ensure fallback also processes newlines if desired
          const fallbackValue = typeof value === 'string' ? value.replace(/\n/g, '  \n') : value;
          setBlocks([{ type: "paragraph", content: [{ type: "text", text: fallbackValue as string, styles: {} }] }]);
        } finally {
          setIsLoading(false);
        }
      };
      parseMarkdown();
    } else if (value === undefined || value === null || value === '') {
      // Handle empty or undefined value gracefully
      setBlocks([]); // Render as empty (RichTextViewer handles empty array)
      setIsLoading(false);
    } else {
      // If value is not a string (e.g. already blocks, or unexpected type)
      console.warn("RichTextViewerWidget received non-string value or editor not ready, attempting to render directly or as empty:", value);
      // Attempt to use value if it's already in PartialBlock[] format, otherwise empty
      setBlocks(Array.isArray(value) ? value : []);
      setIsLoading(false);
    }
  }, [value, editor]);

  if (isLoading) {
    // Optional: render a loading state
    return (
      <div className="mb-4">
        <div>Loading content...</div>
      </div>
    );
  }

  if (blocks === undefined) {
    // If blocks are still undefined after loading, render nothing or a placeholder
    return (
      <div className="mb-4">
        <div>Error loading content</div>
      </div>
    );
  }

  // RichTextViewer expects PartialBlock[] or a string it can parse (which it does by trying JSON.parse then plain text)
  // Since we've converted Markdown to PartialBlock[], we pass that.
  return (
    <div className="mb-4">
      <RichTextViewer
        id={id}
        content={blocks} // Pass the parsed blocks
        className={options?.className || ''}
      />
    </div>
  );
};

export default RichTextViewerWidget;
