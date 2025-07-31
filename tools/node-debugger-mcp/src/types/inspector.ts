// V8 Inspector Protocol types
// Based on Chrome DevTools Protocol specification

export interface InspectorMessage {
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: InspectorError;
}

export interface InspectorError {
  code: number;
  message: string;
  data?: any;
}

export interface BreakpointLocation {
  scriptId: string;
  lineNumber: number;
  columnNumber?: number;
}

export interface CallFrame {
  callFrameId: string;
  functionName: string;
  functionLocation?: BreakpointLocation;
  location: BreakpointLocation;
  url: string;
  scopeChain: Scope[];
  this: RemoteObject;
  returnValue?: RemoteObject;
  canBeRestarted?: boolean;
}

export interface Scope {
  type: ScopeType;
  object: RemoteObject;
  name?: string;
  startLocation?: BreakpointLocation;
  endLocation?: BreakpointLocation;
}

export type ScopeType = 
  | 'global'
  | 'local'  
  | 'with'
  | 'closure'
  | 'catch'
  | 'block'
  | 'script'
  | 'eval'
  | 'module'
  | 'wasm-expression-stack';

export interface RemoteObject {
  type: RemoteObjectType;
  subtype?: RemoteObjectSubtype;
  className?: string;
  value?: any;
  unserializableValue?: UnserializableValue;
  description?: string;
  objectId?: string;
  preview?: ObjectPreview;
  customPreview?: CustomPreview;
}

export type RemoteObjectType = 
  | 'object'
  | 'function'
  | 'undefined'
  | 'string'
  | 'number'
  | 'boolean'
  | 'symbol'
  | 'bigint'
  | 'wasm';

export type RemoteObjectSubtype =
  | 'array'
  | 'null'
  | 'node'
  | 'regexp'
  | 'date'
  | 'map'
  | 'set'
  | 'weakmap'
  | 'weakset'
  | 'iterator'
  | 'generator'
  | 'error'
  | 'proxy'
  | 'promise'
  | 'typedarray'
  | 'arraybuffer'
  | 'dataview'
  | 'webassemblymemory'
  | 'wasmvalue';

export type UnserializableValue = 
  | 'Infinity'
  | 'NaN'
  | '-Infinity'
  | '-0';

export interface ObjectPreview {
  type: RemoteObjectType;
  subtype?: RemoteObjectSubtype;
  description?: string;
  overflow: boolean;
  properties: PropertyPreview[];
  entries?: EntryPreview[];
}

export interface PropertyPreview {
  name: string;
  type: RemoteObjectType;
  value?: string;
  valuePreview?: ObjectPreview;
  subtype?: RemoteObjectSubtype;
}

export interface EntryPreview {
  key?: ObjectPreview;
  value: ObjectPreview;
}

export interface CustomPreview {
  header: string;
  bodyGetterId?: string;
}

export interface Script {
  scriptId: string;
  url: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  executionContextId: number;
  hash: string;
  executionContextAuxData?: any;
  isLiveEdit?: boolean;
  sourceMapURL?: string;
  hasSourceURL?: boolean;
  isModule?: boolean;
  length?: number;
  stackTrace?: StackTrace;
  codeOffset?: number;
  scriptLanguage?: string;
  debugSymbols?: DebugSymbols;
}

export interface StackTrace {
  description?: string;
  callFrames: CallFrame[];
  parent?: StackTrace;
  parentId?: StackTraceId;
}

export interface StackTraceId {
  id: string;
  debuggerId?: string;
}

export interface DebugSymbols {
  type: DebugSymbolType;
  externalURL?: string;
}

export type DebugSymbolType = 'None' | 'SourceMap' | 'EmbeddedDWARF' | 'ExternalDWARF';

// Inspector Events
export interface DebuggerPausedEvent {
  callFrames: CallFrame[];
  reason: PauseReason;
  data?: any;
  hitBreakpoints?: string[];
  asyncStackTrace?: StackTrace;
  asyncStackTraceId?: StackTraceId;
  asyncCallStackTraceId?: StackTraceId;
}

export type PauseReason = 
  | 'ambiguous'
  | 'assert'
  | 'csp-violation'
  | 'debugCommand'
  | 'dom'
  | 'eventListener'
  | 'exception'
  | 'instrumentation'
  | 'oom'
  | 'other'
  | 'promiseRejection'
  | 'step'
  | 'breakpoint';

export interface DebuggerResumedEvent {
  // No specific properties - just indicates execution resumed
}

export interface ScriptParsedEvent {
  scriptId: string;
  url: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  executionContextId: number;
  hash: string;
  executionContextAuxData?: any;
  isLiveEdit?: boolean;
  sourceMapURL?: string;
  hasSourceURL?: boolean;
  isModule?: boolean;
  length?: number;
  stackTrace?: StackTrace;
  codeOffset?: number;
  scriptLanguage?: string;
  debugSymbols?: DebugSymbols;
}