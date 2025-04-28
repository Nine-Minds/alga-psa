'use client';

import React from 'react';
import Editor, { EditorProps } from '@monaco-editor/react';

// Renamed Props interface
interface TypeScriptEditorProps {
  value: string;
  onChange: (value: string | undefined) => void;
  readOnly?: boolean;
  editorProps?: EditorProps;
}

// Renamed Component
const TypeScriptEditor: React.FC<TypeScriptEditorProps> = ({
  value,
  onChange,
  readOnly = false,
  editorProps = {},
}) => {
  const defaultOptions: EditorProps['options'] = {
    readOnly: readOnly,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    // Add other desired Monaco options here
  };

  return (
    <Editor
      height="400px" // Default height, can be overridden by editorProps
      language="typescript" // Keep using TypeScript language mode
      theme="vs-dark" // Or use a light theme if preferred
      value={value}
      onChange={onChange}
      options={{ ...defaultOptions, ...editorProps.options }}
      {...editorProps} // Spread remaining props
    />
  );
};

// Export renamed component
export default TypeScriptEditor;