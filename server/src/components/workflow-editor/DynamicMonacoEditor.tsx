import React from 'react';
import Editor, { Monaco } from "@monaco-editor/react";
import { editor } from "monaco-editor";

interface DynamicMonacoEditorProps {
  height: string;
  language: string;
  value: string;
  onChange: (value: string | undefined) => void;
  onMount: (editor: editor.IStandaloneCodeEditor, monaco: Monaco) => void;
  beforeMount: (monaco: Monaco) => void;
  options: editor.IStandaloneEditorConstructionOptions;
  loading?: React.ReactNode;
}

const DynamicMonacoEditor: React.FC<DynamicMonacoEditorProps> = (props) => {
  return <Editor {...props} />;
};

export default DynamicMonacoEditor;