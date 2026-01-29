'use client';

/**
 * Expression Editor Component
 *
 * A Monaco-based editor for JSONata workflow expressions with:
 * - Syntax highlighting
 * - Context-aware autocomplete
 * - Single-line and multi-line modes
 * - Form field styling integration
 */

import React, { useRef, useEffect, useCallback, useState, useMemo, forwardRef, useImperativeHandle } from 'react';
import Editor, { loader, useMonaco } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { registerJsonataLanguage, LANGUAGE_ID } from './jsonataLanguage';
import { registerJsonataThemes, LIGHT_THEME_NAME } from './jsonataTheme';
import { registerCompletionProvider, type ExpressionContext, type JsonSchema } from './completionProvider';
import { registerHoverProvider } from './hoverProvider';
import { registerSignatureHelpProvider } from './signatureHelpProvider';
import { createDiagnosticsProvider, validateExpression } from './diagnosticsProvider';

/**
 * Props for the ExpressionEditor component
 */
export interface ExpressionEditorProps {
  /** Current expression value */
  value: string;
  /** Called when the expression changes */
  onChange: (value: string) => void;
  /** Context for autocomplete (schemas for payload, vars, etc.) */
  context?: ExpressionContext;
  /** Height of the editor (default: 32 for single-line, 120 for multi-line) */
  height?: number | string;
  /** Single-line mode (default: true) */
  singleLine?: boolean;
  /** Placeholder text when empty */
  placeholder?: string;
  /** Disable editing */
  disabled?: boolean;
  /** Read-only mode */
  readOnly?: boolean;
  /** Error state for form validation */
  hasError?: boolean;
  /** CSS class name */
  className?: string;
  /** Accessible label */
  ariaLabel?: string;
  /** Called when validation errors change */
  onValidationChange?: (errors: string[]) => void;
  /** Called when editor receives focus */
  onFocus?: () => void;
  /** Called when editor loses focus */
  onBlur?: () => void;
}

/**
 * Ref handle for programmatic control
 */
export interface ExpressionEditorHandle {
  /** Focus the editor */
  focus: () => void;
  /** Insert text at cursor position */
  insertAtCursor: (text: string) => void;
  /** Get the editor instance */
  getEditor: () => monaco.editor.IStandaloneCodeEditor | null;
}

// Keep track of whether language/providers are registered globally
// These need to persist across HMR, so we store them on the window object
declare global {
  interface Window {
    __EXPR_EDITOR_STATE__?: {
      languageRegistered: boolean;
      themesRegistered: boolean;
      hoverProviderRegistered: boolean;
      signatureHelpRegistered: boolean;
      completionProviderRegistered: boolean;
      modelContextRegistry: Map<string, ExpressionContext>;
    };
  }
}

// Initialize or retrieve persistent state (survives HMR)
const getEditorState = () => {
  if (typeof window === 'undefined') {
    // SSR - return fresh state that won't be used
    return {
      languageRegistered: false,
      themesRegistered: false,
      hoverProviderRegistered: false,
      signatureHelpRegistered: false,
      completionProviderRegistered: false,
      modelContextRegistry: new Map<string, ExpressionContext>(),
    };
  }
  if (!window.__EXPR_EDITOR_STATE__) {
    window.__EXPR_EDITOR_STATE__ = {
      languageRegistered: false,
      themesRegistered: false,
      hoverProviderRegistered: false,
      signatureHelpRegistered: false,
      completionProviderRegistered: false,
      modelContextRegistry: new Map<string, ExpressionContext>(),
    };
  }
  return window.__EXPR_EDITOR_STATE__;
};

const WORKFLOW_MAPPING_MIME_TYPE = 'application/x-workflow-mapping';

const extractDropText = (dataTransfer: DataTransfer): string | null => {
  const mappingData = dataTransfer.getData(WORKFLOW_MAPPING_MIME_TYPE);
  if (mappingData) {
    try {
      const parsed = JSON.parse(mappingData) as { path?: unknown } | null;
      if (parsed && typeof parsed.path === 'string' && parsed.path.trim()) {
        return parsed.path.trim();
      }
    } catch {
      // ignore and fall back to plain text
    }
  }

  const plain = dataTransfer.getData('text/plain');
  if (plain && plain.trim()) {
    return plain.trim();
  }

  return null;
};

/**
 * Expression Editor Component
 */
export const ExpressionEditor = forwardRef<ExpressionEditorHandle, ExpressionEditorProps>(
  function ExpressionEditor(
    {
      value,
      onChange,
      context = {},
      height,
      singleLine = true,
      placeholder,
      disabled = false,
      readOnly = false,
      hasError = false,
      className = '',
      ariaLabel,
      onValidationChange,
      onFocus,
      onBlur,
    },
    ref
  ) {
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const monacoRef = useRef<typeof monaco | null>(null);
    const contextRef = useRef<ExpressionContext>(context);
    const diagnosticsProviderRef = useRef<ReturnType<typeof createDiagnosticsProvider> | null>(null);
    const diagnosticsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const [isFocused, setIsFocused] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    // Keep context ref updated and sync to global registry
    useEffect(() => {
      contextRef.current = context;
      // Update the global registry if we have a model
      const model = editorRef.current?.getModel();
      if (model) {
        getEditorState().modelContextRegistry.set(model.uri.toString(), context);
      }
    }, [context]);

    // Computed height
    const computedHeight = useMemo(() => {
      if (height !== undefined) return height;
      return singleLine ? 32 : 120;
    }, [height, singleLine]);

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      focus: () => {
        editorRef.current?.focus();
      },
      insertAtCursor: (text: string) => {
        const editor = editorRef.current;
        if (!editor) return;
        const selection = editor.getSelection();
        if (!selection) return;
        editor.executeEdits('expression-editor', [
          {
            range: selection,
            text,
            forceMoveMarkers: true,
          },
        ]);
        editor.focus();
      },
      getEditor: () => editorRef.current,
    }));

    // Run diagnostics validation
    const runDiagnostics = useCallback(() => {
      const editor = editorRef.current;
      const monacoInstance = monacoRef.current;
      if (!editor || !monacoInstance) return;

      const model = editor.getModel();
      if (!model) return;

      // Run validation
      const expression = model.getValue();
      const diagnostics = validateExpression(expression, contextRef.current);

      // Update markers
      if (diagnosticsProviderRef.current) {
        diagnosticsProviderRef.current.updateDiagnostics(model, contextRef.current);
      }

      // Notify parent of validation errors
      if (onValidationChange) {
        const errors = diagnostics
          .filter(d => d.severity >= 4) // Warnings and errors
          .map(d => d.message);
        onValidationChange(errors);
      }
    }, [onValidationChange]);

    // Handle editor mount
    const handleEditorDidMount = useCallback(
      (editor: monaco.editor.IStandaloneCodeEditor, monacoInstance: typeof monaco) => {
        editorRef.current = editor;
        monacoRef.current = monacoInstance;
        setIsLoading(false);

        // Get the persistent editor state (survives HMR)
        const state = getEditorState();

        // Register language and themes if not already done
        if (!state.languageRegistered) {
          registerJsonataLanguage(monacoInstance);
          state.languageRegistered = true;
        }
        if (!state.themesRegistered) {
          registerJsonataThemes(monacoInstance);
          state.themesRegistered = true;
        }

        // Register hover provider (global, one per monaco instance)
        if (!state.hoverProviderRegistered) {
          registerHoverProvider(monacoInstance, () => contextRef.current);
          state.hoverProviderRegistered = true;
        }

        // Register signature help provider (global, one per monaco instance)
        if (!state.signatureHelpRegistered) {
          registerSignatureHelpProvider(monacoInstance);
          state.signatureHelpRegistered = true;
        }

        // Register completion provider globally (once per monaco instance)
        // Uses modelContextRegistry to get the correct context for each editor
        if (!state.completionProviderRegistered) {
          registerCompletionProvider(monacoInstance, (model) => {
            // Look up context from registry using model URI
            // Use getEditorState() to ensure we always get the current registry
            const currentState = getEditorState();
            if (model) {
              return currentState.modelContextRegistry.get(model.uri.toString()) ?? {};
            }
            return {};
          });
          state.completionProviderRegistered = true;
        }

        // Add this model's context to the global registry
        const model = editor.getModel();
        if (model) {
          state.modelContextRegistry.set(model.uri.toString(), contextRef.current);
        }

        // Create diagnostics provider
        diagnosticsProviderRef.current = createDiagnosticsProvider(monacoInstance);

        // Set up content change handler for diagnostics
        editor.onDidChangeModelContent(() => {
          // Debounce diagnostics
          if (diagnosticsTimeoutRef.current) {
            clearTimeout(diagnosticsTimeoutRef.current);
          }
          diagnosticsTimeoutRef.current = setTimeout(() => {
            runDiagnostics();
          }, 300);
        });

        // Run initial diagnostics
        runDiagnostics();

        // Set up focus handlers
        editor.onDidFocusEditorWidget(() => {
          setIsFocused(true);
          onFocus?.();
        });
        editor.onDidBlurEditorWidget(() => {
          setIsFocused(false);
          onBlur?.();
        });

        // Handle single-line mode: prevent Enter from inserting newline
        if (singleLine) {
          editor.addCommand(monacoInstance.KeyCode.Enter, () => {
            // Do nothing - prevent newline insertion
            // Could trigger form submit or blur here if desired
          });
        }

        // Set up keyboard shortcut for autocomplete
        editor.addCommand(
          monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Space,
          () => {
            editor.trigger('keyboard', 'editor.action.triggerSuggest', {});
          }
        );

        // Normalize drag/drop insertion (avoid snippet placeholders like "$0" being inserted).
        const domNode = editor.getDomNode();
        if (domNode) {
          const handleDragOver = (e: DragEvent) => {
            if (!e.dataTransfer) return;
            // Ignore file drops
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) return;
            if (!extractDropText(e.dataTransfer)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          };

          const handleDrop = (e: DragEvent) => {
            if (!e.dataTransfer) return;
            // Ignore file drops
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) return;
            const text = extractDropText(e.dataTransfer);
            if (!text) return;

            e.preventDefault();
            e.stopPropagation();

            // Move cursor to drop location if possible
            const target = editor.getTargetAtClientPoint(e.clientX, e.clientY);
            if (target && 'position' in target && target.position) {
              const pos = target.position;
              editor.setSelection(new monacoInstance.Selection(pos.lineNumber, pos.column, pos.lineNumber, pos.column));
            }

            const selection = editor.getSelection();
            if (!selection) return;

            editor.executeEdits('expression-editor-drop', [
              {
                range: selection,
                // If a snippet placeholder slipped through, strip it.
                text: text.endsWith('$0') ? text.slice(0, -2) : text,
                forceMoveMarkers: true,
              },
            ]);
            editor.focus();
          };

          domNode.addEventListener('dragover', handleDragOver, true);
          domNode.addEventListener('drop', handleDrop, true);

          editor.onDidDispose(() => {
            domNode.removeEventListener('dragover', handleDragOver, true);
            domNode.removeEventListener('drop', handleDrop, true);
          });
        }
      },
      [singleLine, onFocus, onBlur, runDiagnostics]
    );

    // Clean up on unmount
    useEffect(() => {
      return () => {
        if (diagnosticsTimeoutRef.current) {
          clearTimeout(diagnosticsTimeoutRef.current);
        }
        // Clear diagnostics markers and remove from context registry
        const editor = editorRef.current;
        const monacoInstance = monacoRef.current;
        if (editor && monacoInstance) {
          const model = editor.getModel();
          if (model) {
            // Remove from context registry
            getEditorState().modelContextRegistry.delete(model.uri.toString());
            // Clear diagnostics markers
            if (diagnosticsProviderRef.current) {
              diagnosticsProviderRef.current.clearDiagnostics(model);
            }
          }
        }
      };
    }, []);

    // Handle value change with debouncing
    const handleChange = useCallback(
      (newValue: string | undefined) => {
        onChange(newValue ?? '');
      },
      [onChange]
    );

    // Editor options
    const options: monaco.editor.IStandaloneEditorConstructionOptions = useMemo(
      () => ({
        // Appearance
        minimap: { enabled: false },
        scrollbar: {
          vertical: singleLine ? 'hidden' : 'auto',
          horizontal: singleLine ? 'auto' : 'auto',
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
        },
        lineNumbers: singleLine ? 'off' : 'on',
        lineDecorationsWidth: singleLine ? 0 : 10,
        lineNumbersMinChars: singleLine ? 0 : 3,
        glyphMargin: false,
        folding: false,
        renderLineHighlight: singleLine ? 'none' : 'line',
        overviewRulerLanes: 0,
        overviewRulerBorder: false,
        hideCursorInOverviewRuler: true,

        // Behavior
        readOnly: readOnly || disabled,
        wordWrap: singleLine ? 'off' : 'on',
        scrollBeyondLastLine: false,
        automaticLayout: true,

        // Font
        fontSize: 13,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontLigatures: false,

        // Features
        quickSuggestions: true,
        suggestOnTriggerCharacters: true,
        fixedOverflowWidgets: true,
        acceptSuggestionOnEnter: 'on',
        tabCompletion: 'on',
        wordBasedSuggestions: 'off',
        parameterHints: { enabled: true },
        suggest: {
          showWords: false,
          showSnippets: true,
          showFunctions: true,
          showVariables: true,
          showKeywords: true,
          insertMode: 'replace',
        },

        // Accessibility
        accessibilitySupport: 'auto',
        ariaLabel: ariaLabel || 'Expression editor',

        // Padding
        padding: {
          top: singleLine ? 4 : 8,
          bottom: singleLine ? 4 : 8,
        },

        // Cursor
        cursorStyle: 'line',
        cursorBlinking: 'smooth',
      }),
      [singleLine, readOnly, disabled, ariaLabel]
    );

    // Wrapper class names
    const wrapperClasses = useMemo(() => {
      const base = 'rounded-md border transition-colors overflow-hidden';
      const focusRing = isFocused ? 'ring-2 ring-primary-500 ring-offset-1' : '';
      const errorBorder = hasError ? 'border-red-500' : 'border-gray-300';
      const disabledStyle = disabled ? 'opacity-50 cursor-not-allowed bg-gray-50' : 'bg-white';
      return `${base} ${focusRing} ${errorBorder} ${disabledStyle} ${className}`.trim();
    }, [isFocused, hasError, disabled, className]);

    return (
      <div className={wrapperClasses} style={{ height: computedHeight }}>
        {isLoading && (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            Loading editor...
          </div>
        )}
        <Editor
          height="100%"
          language={LANGUAGE_ID}
          theme={LIGHT_THEME_NAME}
          value={value}
          onChange={handleChange}
          onMount={handleEditorDidMount}
          options={options}
          loading={null} // We handle loading ourselves
        />
        {/* Placeholder overlay when empty and not focused */}
        {placeholder && !value && !isFocused && !isLoading && (
          <div
            className="absolute inset-0 pointer-events-none flex items-center px-3 text-gray-400 text-sm font-mono"
            style={{ paddingTop: singleLine ? 4 : 8 }}
          >
            {placeholder}
          </div>
        )}
      </div>
    );
  }
);

export type { ExpressionContext, JsonSchema };
export default ExpressionEditor;
