'use client';

import React from 'react';
import Editor from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";

interface DynamicMonacoEditorProps {
  height: string;
  language: string;
  value: string;
  onChange: (value: string | undefined) => void;
  onMount: (editor: MonacoEditor.IStandaloneCodeEditor, monaco: Monaco) => void;
  beforeMount: (monaco: Monaco) => void;
  options: MonacoEditor.IStandaloneEditorConstructionOptions;
  loading?: React.ReactNode;
}

const DynamicMonacoEditor: React.FC<DynamicMonacoEditorProps> = (props) => {
  return <Editor {...props} />;
};

export default DynamicMonacoEditor;
