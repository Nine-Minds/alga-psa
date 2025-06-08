"use client";
import React, { useEffect, useState, useRef } from 'react';
import { ArrowRight, Eye, Code, ExternalLink } from 'lucide-react';
import io from 'socket.io-client';
import Image from 'next/image';
import { Box, Flex, Grid, Text, TextArea, Button, Card, ScrollArea, Dialog } from '@radix-ui/themes';
import { Theme } from '@radix-ui/themes';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { prompts } from '../tools/prompts';
import { invokeTool } from '../tools/invokeTool';
import { ChatMessage } from '../types/messages';
import { resolveDevServiceUrl } from '../lib/resolveDevServiceUrl';

type JsonValue = 
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

interface ToolData {
  name: string;
  input: Record<string, JsonValue>;
  tool_use_id: string;
}

interface UIStateResponse {
  page: {
    title: string;
    url: string;
  };
  result?: JsonValue;
  [key: string]: JsonValue | undefined;
}

interface ExpandedState {
  [path: string]: boolean;
}

interface CollapsedToolState {
  [messageIndex: number]: boolean;
}

interface ToolCallTracker {
  [messageIndex: number]: string; // Maps message index to toolCallId
}

interface ToolNameTracker {
  [messageIndex: number]: string; // Maps message index to tool name
}

interface JsonViewerProps {
  data: JsonValue;
  level?: number;
  path?: string;
  expandedState: ExpandedState;
  setExpandedState: (state: ExpandedState) => void;
}

function JsonViewer({ data, level = 0, path = '', expandedState, setExpandedState }: JsonViewerProps) {
  const isExpanded = expandedState[path] ?? (level < 2);
  const indent = level * 20;

  if (data === null) return <span style={{ color: 'var(--gray-11)' }}>null</span>;
  if (typeof data !== 'object') {
    return <span style={{ color: typeof data === 'string' ? '#c3e88d' : '#ff9cac' }}>
      {JSON.stringify(data)}
    </span>;
  }

  const isArray = Array.isArray(data);
  const isEmpty = Object.keys(data).length === 0;

  if (isEmpty) {
    return <span>{isArray ? '[]' : '{}'}</span>;
  }

  return (
    <Box>
      <Flex 
        align="center" 
        gap="1" 
        style={{ cursor: 'pointer' }} 
        onClick={() => {
          setExpandedState({
            ...expandedState,
            [path]: !isExpanded
          });
        }}
      >
        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span>{isArray ? '[' : '{'}</span>
      </Flex>
      {isExpanded && (
        <Box style={{ paddingLeft: indent + 20 }}>
          {Object.entries(data).map(([key, value], index) => (
            <Box key={key}>
              <Text>
                <span style={{ color: '#89ddff' }}>{isArray ? '' : `"${key}": `}</span>
                <JsonViewer 
                  data={value} 
                  level={level + 1} 
                  path={`${path}${path ? '.' : ''}${key}`}
                  expandedState={expandedState}
                  setExpandedState={setExpandedState}
                />
                {index < Object.keys(data).length - 1 && ','}
              </Text>
            </Box>
          ))}
        </Box>
      )}
      <Box style={{ paddingLeft: indent }}>
        <span>{isArray ? ']' : '}'}</span>
      </Box>
    </Box>
  );
}

export default function ControlPanel() {
  interface ToolContent {
    name: string;
    input?: Record<string, JsonValue>;
  }

  // Define a more specific type for results from invokeTool
  interface MyToolExecutionResult {
    success?: boolean;
    result?: JsonValue;
    error?: string;
    [key: string]: JsonValue | undefined;
  }

  // Base interface for all log entries
  interface BaseLogEntry {
    title: string;
    timestamp: string;
    toolCallId?: string;
  }

  // Specific log entry types for the discriminated union
  interface StringLogEntry extends BaseLogEntry {
    type: 'navigation' | 'error'; // Generic errors or navigation messages
    content: string;
  }

  interface ToolUseLogEntry extends BaseLogEntry {
    type: 'tool_use';
    content: ToolContent;
  }

  interface ToolResultLogEntry extends BaseLogEntry {
    type: 'tool_result';
    content: MyToolExecutionResult; // Content is the result from invokeTool
  }

  // Discriminated union type for LogEntry
  type LogEntry = StringLogEntry | ToolUseLogEntry | ToolResultLogEntry;

  const [imgSrc, setImgSrc] = useState('');
  const [log, setLog] = useState<LogEntry[]>([]);
  const [userMessage, setUserMessage] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [showContext, setShowContext] = useState(false);
  const [showUIState, setShowUIState] = useState(false);
  const [showCodeExecution, setShowCodeExecution] = useState(false);
  const [codeToExecute, setCodeToExecute] = useState('');
  const [uiStateData, setUIStateData] = useState<UIStateResponse | null>(null);
  const [expandedState, setExpandedState] = useState<ExpandedState>({});
  const [collapsedToolState, setCollapsedToolState] = useState<CollapsedToolState>({});
  const [toolCallTracker, setToolCallTracker] = useState<ToolCallTracker>({});
  const [toolNameTracker, setToolNameTracker] = useState<ToolNameTracker>({});
  const [url, setUrl] = useState('http://server:3000');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null); // For fetch cancellation
  const logEntryRefs = useRef<{[key: string]: HTMLDivElement | null}>({});
  const currentAssistantMessageRef = useRef<string>('');
  const isCancelledRef = useRef<boolean>(false);

  const scrollToLogEntry = (toolCallId: string) => {
    const ref = logEntryRefs.current[toolCallId];
    if (ref) {
      const scrollContainer = ref.closest('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        const containerRect = scrollContainer.getBoundingClientRect();
        const elementRect = ref.getBoundingClientRect();
        const scrollTop = scrollContainer.scrollTop;
        const targetScrollTop = scrollTop + (elementRect.top - containerRect.top) - 20;
        scrollContainer.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });
      } else {
        ref.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      ref.style.backgroundColor = 'var(--accent-3)';
      ref.style.transition = 'background-color 0.3s ease';
      setTimeout(() => { ref.style.backgroundColor = ''; }, 2000);
    }
  };

  const scrollMessagesToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  const scrollLogToBottom = () => logEndRef.current?.scrollIntoView({ behavior: 'smooth' });

  useEffect(scrollMessagesToBottom, [messages]);
  useEffect(scrollLogToBottom, [log]);

  useEffect(() => {
    const filteredMessages = messages.filter(msg => msg.role !== 'system');
    const newCollapsedState: CollapsedToolState = {};
    filteredMessages.forEach((msg, idx) => {
      const isToolResult = msg.role === 'user' && msg.content && (msg.content.startsWith('{') || msg.content.startsWith('['));
      const isToolMessage = msg.role === 'tool';
      if ((isToolResult || isToolMessage) && !(idx in collapsedToolState)) {
        newCollapsedState[idx] = true;
      }
    });
    if (Object.keys(newCollapsedState).length > 0) {
      setCollapsedToolState(prev => ({ ...prev, ...newCollapsedState }));
    }
  }, [messages, collapsedToolState]);

  const preStyle: React.CSSProperties = { whiteSpace: 'pre-wrap', overflowWrap: 'break-word', background: 'var(--color-panel)', padding: '8px', borderRadius: '4px', margin: '4px 0' };
  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px', backgroundColor: 'var(--color-panel)', border: 'none', borderRadius: '4px', color: 'inherit', fontSize: 'inherit', outline: 'none' };

  useEffect(() => {
    const systemPrompt = prompts.systemMessage.replace('{url}', url).replace('{username}', username || '[Not provided]').replace('{password}', password || '[Not provided]');
    setMessages([{ role: 'system', content: systemPrompt }]);
  }, [url, username, password]);

  useEffect(() => {
    const socket = io({ transports: ['websocket', 'polling'], reconnection: true, reconnectionAttempts: 5, reconnectionDelay: 1000 });
    socket.on('connect', () => {
      console.log('✅ WebSocket connected', socket.id);
      // @ts-expect-error - engine might not be directly on Manager type in some strict typings
      console.log('Transport:', socket.io.engine.transport.name);
    });
    socket.on('connect_error', (error: Error) => console.error('❌ WebSocket connection error:', error.message, error));
    socket.on('screenshot', (data: string) => setImgSrc(`data:image/png;base64,${data}`));
    socket.on('disconnect', (reason: string) => {
      console.log('🔌 WebSocket disconnected:', reason);
      if (reason === 'io server disconnect') socket.connect();
    });
    socket.on('reconnect', (attemptNumber: number) => console.log('🔄 WebSocket reconnected after', attemptNumber, 'attempts'));
    socket.on('reconnect_error', (error: Error) => console.error('❌ WebSocket reconnection error:', error));
    return () => { socket.disconnect(); };
  }, []);


  const cancelGeneration = () => {
    console.log('Cancelling generation');
    isCancelledRef.current = true;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
    setMessages(prev => {
      const lastMessage = prev[prev.length - 1];
      if (lastMessage && lastMessage.role === 'assistant' && (!lastMessage.content || !lastMessage.content.trim())) {
        return prev.slice(0, -1);
      }
      return prev;
    });
  };

  const clearConversation = () => {
    console.log('Clearing conversation');
    isCancelledRef.current = false;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    const systemPrompt = prompts.systemMessage.replace('{url}', url).replace('{username}', username || '[Not provided]').replace('{password}', password || '[Not provided]');
    setMessages([{ role: 'system', content: systemPrompt }]);
    setIsGenerating(false);
    setUserMessage('');
    setLog([]);
  };


  const handlePopOut = async () => {
    try {
      // Use the current window location to determine the correct external port
      const currentPort = window.location.port;
      const currentProtocol = window.location.protocol;
      const currentHostname = window.location.hostname;
      
      // Build the connection parameters for NoVNC (based on the working config)
      const params = new URLSearchParams({
        // Connection settings
        autoconnect: 'true',
        reconnect: 'true',
        reconnect_delay: '2000',
        
        // IMPORTANT: Use /vnc/websockify path for nginx routing
        path: '/vnc/websockify',
        
        // Display settings
        resize: 'scale',
        quality: '6',
        compression: '2',
        show_dot: 'false',
        view_only: 'false',
        
        // Host and port (NoVNC will construct ws://${host}:${port}${path} internally)
        host: currentHostname,
        port: currentPort || '80',
        
        // Don't use encryption since we're proxying through nginx
        encrypt: 'false'
      });
      
      // Direct link to NoVNC vnc.html with the correct parameters
      const vncUrl = `${currentProtocol}//${currentHostname}:${currentPort}/vnc/vnc.html?${params.toString()}`;
      
      window.open(vncUrl, '_blank');
      setLog(prev => [...prev, { type: 'navigation', title: 'Opening Browser Control', content: `Browser control window opened with direct VNC connection`, timestamp: new Date().toISOString() }]);
    } catch (error) {
      setLog(prev => [...prev, { type: 'error', title: 'Pop Out Error', content: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() }]);
    }
  };

  const cleanAssistantMessage = (message: string) => {
    const withoutFuncCalls = message.replace(/<func-call[^>]*>[\s\S]*?<\/func-call>/g, '');
    const withoutDuplicates = withoutFuncCalls.replace(/(<func-call[^>]*>[\s\S]*?<\/func-call>)\s*\1+/g, '$1');
    return withoutDuplicates.trim();
  };

  const processStream = async (
    reader: ReadableStreamDefaultReader<Uint8Array>, 
    decoder: TextDecoder,
    onToken: (data: string) => void,
    onToolUse: (toolData: ToolData) => void, 
    onDone: () => void,
    onError: (error: Error) => void
  ) => {
    let buffer = '';
    try {
      while (true) {
        if (isCancelledRef.current) {
          console.log('[CLIENT] Stream reading cancelled by user in processStream.');
          // Don't call onError here as cancelGeneration handles UI
          return; 
        }
        const { done, value } = await reader.read();
        if (done) {
          console.log('[CLIENT] Stream finished.');
          onDone();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        
        let eventEndIndex;
        while ((eventEndIndex = buffer.indexOf('\n\n')) !== -1) {
          const eventString = buffer.substring(0, eventEndIndex);
          buffer = buffer.substring(eventEndIndex + 2); // Consume the event and the trailing \n\n

          if (eventString.startsWith('event: ')) {
            const lines = eventString.split('\n');
            const eventTypeLine = lines.find(line => line.startsWith('event: '));
            const eventDataLine = lines.find(line => line.startsWith('data: '));
            
            if (eventTypeLine && eventDataLine) {
              const eventType = eventTypeLine.substring('event: '.length).trim();
              const eventDataJson = eventDataLine.substring('data: '.length);
              
              try {
                const parsedEvent = JSON.parse(eventDataJson);
                // For token events, data is a string. For tool_use events, data is a JSON string that needs parsing
                let actualData = parsedEvent.data;
                if (eventType === 'tool_use' && typeof actualData === 'string') {
                  try {
                    actualData = JSON.parse(actualData);
                  } catch (e) {
                    console.warn('[CLIENT] Failed to parse tool_use data as JSON:', actualData);
                  }
                } 

                if (parsedEvent.type !== eventType) {
                  console.warn(`[CLIENT] Mismatched event types: SSE event says '${eventType}', JSON says '${parsedEvent.type}'`);
                }
                
                if (isCancelledRef.current) return; // Check cancellation before processing

                if (eventType === 'token') {
                  onToken(actualData);
                } else if (eventType === 'tool_use') {
                  onToolUse(actualData);
                  return; 
                } else if (eventType === 'done') {
                  onDone();
                  return; 
                } else if (eventType === 'error') {
                  onError(new Error(actualData));
                  return;
                }
              } catch (e) {
                console.error('[CLIENT] Error parsing SSE event data JSON:', e, eventDataJson);
              }
            }
          }
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        console.log('[CLIENT] Stream reading aborted.');
        if (!isCancelledRef.current) {
            onError(new Error("Stream aborted unexpectedly"));
        }
      } else {
        console.error('[CLIENT] Error reading stream:', error);
        onError(error as Error);
      }
    } finally {
      // Reader lock is automatically released when the stream is closed or errors.
    }
  };

  const startNewSseSession = async (
    filteredMessages: ChatMessage[],
    onToken: (data: string) => void,
    onToolUse: (toolData: ToolData) => void,
    onDone: () => void,
    onError: (error: Error) => void
  ) => {
    if (isCancelledRef.current) {
      console.log('Session cancelled, not starting new fetch connection');
      onError(new Error('Cancelled by user'));
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    currentAssistantMessageRef.current = '';

    console.log('[CLIENT] Starting new fetch session to /api/ai (POST)');
    console.log('[CLIENT] Message count:', filteredMessages.length);

    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: filteredMessages }),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        onError(new Error(`HTTP error! status: ${response.status}, text: ${errorText}`));
        return;
      }
      if (!response.body) {
        onError(new Error('Response body is null'));
        return;
      }

      console.log('[CLIENT] Fetch request successful, stream ready for processing.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      processStream(reader, decoder, onToken, onToolUse, onDone, onError).catch(streamError => {
        console.error("[CLIENT] Unhandled error in processStream:", streamError);
        onError(streamError instanceof Error ? streamError : new Error(String(streamError)));
      });

    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        console.log('[CLIENT] Fetch setup aborted');
        if (!isCancelledRef.current) {
            onError(new Error("Fetch aborted unexpectedly during setup"));
        }
      } else {
        console.error('[CLIENT] Fetch error in startNewSseSession:', error);
        onError(error as Error);
      }
    }
  };

  const sendMessagesToAI = async (messages: ChatMessage[]) => {
    setIsGenerating(true);
    setUserMessage('');
    isCancelledRef.current = false; 
    
    let hasToolCallsThisSegment = false;

    const filteredMessages = messages.filter(msg => {
      if (msg.role === 'system') return true;
      if (msg.role === 'assistant') return !!(msg.content || msg.tool_calls);
      if (msg.role === 'user') return true; 
      return false;
    });
    setMessages([...filteredMessages, { role: 'assistant', content: '' }]);

    try {
      await startNewSseSession(
        filteredMessages,
        // onToken
        (tokenData: string) => {
          if (isCancelledRef.current) return;
          currentAssistantMessageRef.current += tokenData;
          setMessages(prev => {
            const updated = [...prev];
            const lastMessage = updated[updated.length - 1];
            if (lastMessage && lastMessage.role === 'assistant') {
              lastMessage.content = currentAssistantMessageRef.current;
            }
            return updated;
          });
        },
        // onToolUse
        async (toolData: ToolData) => {
          if (isCancelledRef.current) return;
          hasToolCallsThisSegment = true;
          console.log('%c[FRONTEND] 🎯 Received tool use event', 'color: #ff6b6b; font-weight: bold', toolData);

          const toolContent = { name: toolData.name, input: toolData.input };
          const toolCallId = toolData.tool_use_id;
          
          setLog(prev => [...prev, { type: 'tool_use', title: 'Tool Use Requested', content: toolContent, timestamp: new Date().toISOString(), toolCallId }]);
          
          const result = await invokeTool(toolContent.name, toolContent.input);
          
          if (isCancelledRef.current) {
            setLog(prev => [...prev, { type: 'error', title: 'Tool Cancelled', content: 'Tool execution was cancelled by user.', timestamp: new Date().toISOString(), toolCallId }]);
            return;
          }

          const toolResultMsg: ChatMessage = { role: 'user', content: JSON.stringify(result.success ? result.result : result) };
          setLog(prev => [...prev, { type: 'tool_result', title: result.success ? 'Tool Result' : 'Tool Error', content: result as MyToolExecutionResult, timestamp: new Date().toISOString(), toolCallId }]);

          setMessages(prev => {
            const updatedMessages = [...prev];
            const lastMsg = updatedMessages[updatedMessages.length -1];
            if(lastMsg.role === 'assistant' && !lastMsg.content && !lastMsg.tool_calls) {
               updatedMessages.push(toolResultMsg);
            } else {
               updatedMessages.push(toolResultMsg);
            }

            const toolResultIndex = updatedMessages.filter(m => m.role !== 'system').length - 1;
            setToolCallTracker(t => ({ ...t, [toolResultIndex]: toolCallId }));
            setToolNameTracker(t => ({ ...t, [toolResultIndex]: toolContent.name }));
            
            sendMessagesToAI(updatedMessages); 
            return updatedMessages;
          });
        },
        // onDone
        () => {
          if (isCancelledRef.current) return;
          console.log('Received done event from stream.');
          if (!hasToolCallsThisSegment) {
            setIsGenerating(false);
          }
        },
        // onError
        (error: Error) => {
          if (isCancelledRef.current && error.message === "Cancelled by user") {
            console.log("Generation cancelled by user, error callback suppressed.");
            return;
          }
          console.error('Streaming error callback:', error);
          setLog(prev => [...prev, { type: 'error', title: 'Streaming Error', content: error.message, timestamp: new Date().toISOString() }]);
          setIsGenerating(false);
        }
      );
    } catch (error) {
      console.error('Error in sendMessagesToAI (outer try-catch):', error);
      setLog(prev => [...prev, { type: 'error', title: 'Error', content: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() }]);
      setIsGenerating(false);
    }
  };

  return (
    <Theme appearance="dark" accentColor="purple" grayColor="slate">
      <Box p="8" style={{ minHeight: '100vh', backgroundColor: 'var(--color-background)' }}>
        <Flex direction="column" gap="8" style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <Text size="8" weight="bold">AI Automation Control Panel</Text>
          
          <Grid columns={{ initial: '1', lg: '3' }} gap="8">
            {/* Sidebar */}
            <Flex direction="column" gap="4" style={{ gridColumn: 'span 2' }}>
              <Card>
                <Flex direction="column" gap="4">
                  <Flex justify="between" align="center">
                    <Text size="5" weight="bold">Chat with AI</Text>
                    <Flex gap="2">
                      <Button
                        variant="ghost"
                        onClick={() => setShowCodeExecution(true)}
                        style={{ 
                          padding: '6px',
                          color: '#ff4d4f'
                        }}
                      >
                        <Code size={16} />
                      </Button>
                      <Button 
                        variant="ghost" 
                        onClick={() => setShowContext(true)}
                        style={{ padding: '6px' }}
                      >
                        <Eye size={16} />
                      </Button>
                      <Button 
                        variant="ghost"
                        onClick={async () => {
                          try {
                            console.log('[CLIENT] Fetching UI state from /api/ui-state (proxy to backend)');
                            const response = await fetch('/api/ui-state');
                            console.log('[CLIENT] UI state response:', response.status, response.statusText);
                            if (!response.ok) {
                              throw new Error('Failed to fetch UI state');
                            }
                            const data = await response.json();
                            console.log('[CLIENT] UI state data:', data);
                            setUIStateData(data);
                            setShowUIState(true);
                          } catch (error) {
                            console.error('[CLIENT] UI state error:', error);
                            setLog(prev => [...prev, {
                              type: 'error',
                              title: 'UI State Error',
                              content: error instanceof Error ? error.message : String(error),
                              timestamp: new Date().toISOString()
                            }]);
                          }
                        }}
                        style={{ 
                          padding: '6px',
                          color: '#0091FF'
                        }}
                      >
                        <Eye size={16} />
                      </Button>
                    </Flex>
                  </Flex>
                  <Flex direction="column" gap="4">
                    <Flex gap="2">
                      <Box style={{ flex: 1 }}>
                        <input
                          type="text"
                          value={url}
                          onChange={(e) => setUrl(e.target.value)}
                          placeholder="URL"
                          style={inputStyle}
                        />
                      </Box>
                      <Button
                        style={{ padding: '0 8px', height: '37px' }}
                        onClick={async () => {
                          try {
                            console.log('[CLIENT] Navigating via /api/puppeteer (proxy to backend)');
                            console.log('[CLIENT] Navigation URL:', url);
                            
                            const resolvedUrl = process.env.NEXT_PUBLIC_ALGA_DEV_ENV === 'true' 
                              ? resolveDevServiceUrl(url) 
                              : url;
                            
                            console.log('[CLIENT] Resolved URL:', resolvedUrl);
                            
                            const response = await fetch('/api/puppeteer', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                script: `(async () => { await helper.navigate('${resolvedUrl}'); })();`
                              })
                            });
                            console.log('[CLIENT] Navigation response:', response.status, response.statusText);
                            if (!response.ok) {
                              throw new Error('Navigation failed');
                            }
                            const result = await response.json();
                            console.log('[CLIENT] Navigation result:', result);
                            setLog(prev => [...prev, {
                              type: 'navigation',
                              title: 'Navigation',
                              content: `Navigated to: ${url}`,
                              timestamp: new Date().toISOString()
                            }]);
                          } catch (error: unknown) {
                            console.error('[CLIENT] Navigation error:', error);
                            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                            setLog(prev => [...prev, {
                              type: 'error',
                              title: 'Navigation Error',
                              content: errorMessage,
                              timestamp: new Date().toISOString()
                            }]);
                          }
                        }}
                      >
                        <ArrowRight size={16} />
                      </Button>
                    </Flex>
                    
                    {/* Browser Control */}
                    <Flex gap="2" align="center">
                      <Text size="2" style={{ color: 'var(--gray-11)' }}>
                        Browser Control:
                      </Text>
                      <Button
                        size="1"
                        variant="solid"
                        onClick={handlePopOut}
                        style={{ 
                          padding: '4px 8px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <ExternalLink size={12} />
                        Pop Out
                      </Button>
                    </Flex>
                    <Flex gap="4">
                      <Box style={{ flex: 1 }}>
                        <input
                          type="text"
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          placeholder="Username"
                          autoComplete="off"
                          style={inputStyle}
                        />
                      </Box>
                      <Box style={{ flex: 1 }}>
                        <input
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Password"
                          autoComplete="off"
                          style={inputStyle}
                        />
                      </Box>
                    </Flex>
                  </Flex>
                  <ScrollArea style={{ height: '600px', backgroundColor: 'var(--color-panel)' }}>
                    <Flex direction="column" gap="2" p="2">
                      {messages.filter(msg => msg.role !== 'system').map((msg, idx) => {
                        // Check if this is a tool result (user message with JSON content)
                        const isToolResult = msg.role === 'user' && msg.content && 
                          (msg.content.startsWith('{') || msg.content.startsWith('['));
                        
                        return (
                          <Box key={idx}>
                            <Text color={
                              isToolResult ? 'orange' :
                              msg.role === 'user' ? 'blue' : 
                              msg.role === 'assistant' ? 'green' : 
                              'gray'
                            } mb="2">
                              <strong>
                                {isToolResult ? `Tool Result${toolNameTracker[idx] ? ` (${toolNameTracker[idx]})` : ''}` :
                                 msg.role === 'user' ? 'User' 
                                 : msg.role === 'assistant' ? 'AI'
                                 : msg.role === 'tool' ? 'Tool Response'
                                 : 'System'}
                                :
                              </strong>
                            </Text>
                          {msg.tool_calls?.[0] && (
                            <Box 
                              mb="2" 
                              style={{
                                backgroundColor: 'var(--accent-9)',
                                padding: '8px 12px',
                                borderRadius: '4px',
                                display: 'inline-block',
                                cursor: 'pointer'
                              }}
                              onClick={() => msg.tool_calls?.[0] && scrollToLogEntry(msg.tool_calls[0].id)}
                            >
                              <Text size="2" style={{ color: 'white' }}>
                                🔧 Function Call: {msg.tool_calls[0].function.name}
                              </Text>
                            </Box>
                          )}
                          {msg.role === 'tool' ? (
                            <Box mb="2">
                              <Flex 
                                align="center" 
                                gap="2" 
                                style={{ cursor: 'pointer' }} 
                                onClick={() => {
                                  setCollapsedToolState(prev => ({
                                    ...prev,
                                    [idx]: !prev[idx]
                                  }));
                                }}
                              >
                                {collapsedToolState[idx] ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                                <Text size="2" style={{ color: 'var(--accent-9)' }}>
                                  Function: {msg.name}
                                </Text>
                                {msg.tool_call_id && (
                                  <Box 
                                    ml="2"
                                    style={{
                                      backgroundColor: 'var(--accent-9)',
                                      padding: '2px 6px',
                                      borderRadius: '3px',
                                      fontSize: '11px',
                                      cursor: 'pointer'
                                    }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      scrollToLogEntry(msg.tool_call_id!);
                                    }}
                                  >
                                    <Text size="1" style={{ color: 'white' }}>
                                      📋 View in Log
                                    </Text>
                                  </Box>
                                )}
                              </Flex>
                              {!collapsedToolState[idx] && (
                                <pre style={{ ...preStyle, maxWidth: '100%', marginTop: '8px' }}>
                                  {msg.content}
                                </pre>
                              )}
                            </Box>
                          ) : isToolResult ? (
                            <Box mb="2">
                              <Flex 
                                align="center" 
                                gap="2" 
                                style={{ cursor: 'pointer' }} 
                                onClick={() => {
                                  setCollapsedToolState(prev => ({
                                    ...prev,
                                    [idx]: !prev[idx]
                                  }));
                                }}
                              >
                                {collapsedToolState[idx] ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                                <Text size="2" style={{ color: 'var(--accent-9)' }}>
                                  {toolNameTracker[idx] ? `${toolNameTracker[idx]} Result` : 'Tool Result'} ({collapsedToolState[idx] ? 'Click to expand' : 'Click to collapse'})
                                </Text>
                                {toolCallTracker[idx] && (
                                  <Box 
                                    ml="2"
                                    style={{
                                      backgroundColor: 'var(--accent-9)',
                                      padding: '2px 6px',
                                      borderRadius: '3px',
                                      fontSize: '11px',
                                      cursor: 'pointer'
                                    }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      scrollToLogEntry(toolCallTracker[idx]);
                                    }}
                                  >
                                    <Text size="1" style={{ color: 'white' }}>
                                      📋 View in Log
                                    </Text>
                                  </Box>
                                )}
                              </Flex>
                              {!collapsedToolState[idx] && (
                                <pre style={{ ...preStyle, maxWidth: '100%', marginTop: '8px' }}>
                                  {msg.content}
                                </pre>
                              )}
                            </Box>
                          ) : (
                            msg.content ? cleanAssistantMessage(msg.content).split('\n').map((line: string, lineIdx: number) => (
                              <pre key={lineIdx} style={{ ...preStyle, maxWidth: '100%' }}>
                                {line}
                              </pre>
                            )) : null
                          )}
                          <div ref={messagesEndRef} style={{ height: 1 }} />
                        </Box>
                        );
                      })}
                    </Flex>
                  </ScrollArea>

                  <TextArea
                    value={userMessage}
                    onChange={(e) => {
                        setUserMessage(e.target.value);
                      }
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (!e.shiftKey) {
                          e.preventDefault();
                          if (!isGenerating && userMessage.trim()) {
                            const newMessage: ChatMessage = { role: 'user' as const, content: userMessage.trim() };
                            setMessages(prev => [...prev, newMessage]);
                            sendMessagesToAI([...messages, newMessage]);
                          }
                        }
                      }
                    }}
                    rows={3}
                    placeholder="Type your message here... (Enter to send, Shift+Enter for new line)"
                    style={{ backgroundColor: 'var(--color-panel)' }}
                  />
                  <Flex direction="column" gap="2">
                    <Button 
                      onClick={() => {
                        if (!isGenerating && userMessage.trim()) {
                          const newMessage: ChatMessage = { role: 'user' as const, content: userMessage.trim() };
                          setMessages(prev => [...prev, newMessage]);
                          sendMessagesToAI([...messages, newMessage]);
                        }
                      }}
                      disabled={isGenerating}
                      style={{ width: '100%' }}
                    >
                      {isGenerating ? 'Thinking...' : 'Send'}
                    </Button>
                    {isGenerating && (
                      <Button 
                        onClick={cancelGeneration}
                        color="gray"
                        style={{ width: '100%' }}
                      >
                        Cancel
                      </Button>
                    )}
                    <Button 
                      onClick={clearConversation}
                      color="blue"
                      style={{ width: '100%' }}
                    >
                      Clear Conversation
                    </Button>
                  </Flex>
                </Flex>
              </Card>
            </Flex>

            {/* UI State Dialog */}
            <Dialog.Root open={showUIState} onOpenChange={setShowUIState}>
              <Dialog.Content style={{ maxWidth: 800 }}>
                <Dialog.Title>Current UI State</Dialog.Title>
                <ScrollArea style={{ height: '500px', marginTop: '16px' }}>
                  <Box style={{ 
                    backgroundColor: 'var(--color-panel)',
                    padding: '12px',
                    borderRadius: '6px'
                  }}>
                    <Box style={{ 
                      fontFamily: 'monospace',
                      fontSize: '14px'
                    }}>
                      {uiStateData ? (
                        <JsonViewer 
                          data={uiStateData as JsonValue}
                          expandedState={expandedState}
                          setExpandedState={setExpandedState}
                        />
                      ) : 'Loading...'}
                    </Box>
                  </Box>
                </ScrollArea>
                <Flex gap="3" mt="4" justify="end">
                  <Button 
                    variant="soft" 
                    onClick={() => {
                      const getAllPaths = (obj: JsonValue, parentPath = ''): string[] => {
                        if (obj === null || typeof obj !== 'object') return [];
                        if (Array.isArray(obj)) {
                          return obj.reduce((paths: string[], _, index) => {
                            const currentPath = parentPath ? `${parentPath}.${index}` : index.toString();
                            return [...paths, currentPath, ...getAllPaths(obj[index], currentPath)];
                          }, []);
                        }
                        return Object.entries(obj).reduce((paths: string[], [key, value]) => {
                          const currentPath = parentPath ? `${parentPath}.${key}` : key;
                          return [...paths, currentPath, ...getAllPaths(value, currentPath)];
                        }, []);
                      };
                      
                      const allPaths = getAllPaths(uiStateData as JsonValue);
                      const newState = allPaths.reduce((acc, path) => ({
                        ...acc,
                        [path]: true
                      }), {});
                      
                      setExpandedState(newState);
                    }}
                  >
                    Expand All
                  </Button>
                  <Button 
                    variant="soft" 
                    onClick={() => {
                      setExpandedState({});
                    }}
                  >
                    Collapse All
                  </Button>
                  <Dialog.Close>
                    <Button variant="soft" color="gray">
                      Close
                    </Button>
                  </Dialog.Close>
                </Flex>
              </Dialog.Content>
            </Dialog.Root>

            {/* Code Execution Dialog */}
            <Dialog.Root open={showCodeExecution} onOpenChange={setShowCodeExecution}>
              <Dialog.Content style={{ maxWidth: 600 }}>
                <Dialog.Title>Execute JavaScript Code</Dialog.Title>
                <Box my="4">
                  <TextArea
                    value={codeToExecute}
                    onChange={(e) => setCodeToExecute(e.target.value)}
                    rows={10}
                    placeholder="Enter JavaScript code to execute..."
                    style={{ 
                      backgroundColor: 'var(--color-panel)',
                      fontFamily: 'monospace',
                      fontSize: '14px'
                    }}
                  />
                </Box>
                <Flex gap="3" justify="end">
                  <Dialog.Close>
                    <Button variant="soft" color="gray">
                      Cancel
                    </Button>
                  </Dialog.Close>
                  <Button 
                    onClick={async () => {
                      try {
                        console.log('[CLIENT] Executing code via /api/puppeteer (proxy to backend)');
                        console.log('[CLIENT] Code to execute:', codeToExecute);
                        const response = await fetch('/api/puppeteer', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            script: codeToExecute
                          })
                        });
                        console.log('[CLIENT] Code execution response:', response.status, response.statusText);
                        if (!response.ok) {
                          throw new Error('Code execution failed');
                        }
                        const result = await response.json();
                        console.log('[CLIENT] Code execution result:', result);
                        setLog(prev => [...prev, {
                          type: 'navigation',
                          title: 'Code Execution',
                          content: `Executed code:\n${codeToExecute}`,
                          timestamp: new Date().toISOString()
                        }]);
                        setShowCodeExecution(false);
                      } catch (error: unknown) {
                        console.error('[CLIENT] Code execution error:', error);
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                        setLog(prev => [...prev, {
                          type: 'error',
                          title: 'Code Execution Error',
                          content: errorMessage,
                          timestamp: new Date().toISOString()
                        }]);
                      }
                    }}
                  >
                    Execute
                  </Button>
                </Flex>
              </Dialog.Content>
            </Dialog.Root>

            {/* Context Dialog */}
            <Dialog.Root open={showContext} onOpenChange={setShowContext}>
              <Dialog.Content style={{ maxWidth: 600 }}>
                <Dialog.Title>Conversation Context</Dialog.Title>
                <ScrollArea style={{ height: '400px', marginTop: '16px' }}>
                  <Flex direction="column" gap="2">
                    {messages.map((msg, idx) => {
                      // Check if this is a tool result (user message with JSON content)
                      const isToolResult = msg.role === 'user' && msg.content && 
                        (msg.content.startsWith('{') || msg.content.startsWith('['));
                      
                      return (
                        <Box key={idx}>
                          <Text color={
                            isToolResult ? 'orange' :
                            msg.role === 'user' ? 'blue' : 
                            msg.role === 'assistant' ? 'green' : 
                            'gray'
                          } mb="2">
                            <strong>
                              {isToolResult ? `Tool Result${toolNameTracker[idx] ? ` (${toolNameTracker[idx]})` : ''}` :
                               msg.role === 'user' ? 'User'
                               : msg.role === 'assistant' ? 'AI'
                               : msg.role === 'tool' ? 'Tool Response'
                               : 'System'}
                              :
                            </strong>
                          </Text>
                        {msg.role === 'tool' ? (
                          <Box mb="2">
                            <Flex 
                              align="center" 
                              gap="2" 
                              style={{ cursor: 'pointer' }} 
                              onClick={() => {
                                setCollapsedToolState(prev => ({
                                  ...prev,
                                  [idx]: !prev[idx]
                                }));
                              }}
                            >
                              {collapsedToolState[idx] ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                              <Text size="2" style={{ color: 'var(--accent-9)' }}>
                                Function: {msg.name}
                              </Text>
                              {msg.tool_call_id && (
                                <Box 
                                  ml="2"
                                  style={{
                                    backgroundColor: 'var(--accent-9)',
                                    padding: '2px 6px',
                                    borderRadius: '3px',
                                    fontSize: '11px',
                                    cursor: 'pointer'
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    scrollToLogEntry(msg.tool_call_id!);
                                  }}
                                >
                                  <Text size="1" style={{ color: 'white' }}>
                                    📋 View in Log
                                  </Text>
                                </Box>
                              )}
                            </Flex>
                            {!collapsedToolState[idx] && (
                              <pre style={{ ...preStyle, marginTop: '8px' }}>
                                {msg.content}
                              </pre>
                            )}
                          </Box>
                        ) : isToolResult ? (
                          <Box mb="2">
                            <Flex 
                              align="center" 
                              gap="2" 
                              style={{ cursor: 'pointer' }} 
                              onClick={() => {
                                setCollapsedToolState(prev => ({
                                  ...prev,
                                  [idx]: !prev[idx]
                                }));
                              }}
                            >
                              {collapsedToolState[idx] ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                              <Text size="2" style={{ color: 'var(--accent-9)' }}>
                                {toolNameTracker[idx] ? `${toolNameTracker[idx]} Result` : 'Tool Result'} ({collapsedToolState[idx] ? 'Click to expand' : 'Click to collapse'})
                              </Text>
                              {toolCallTracker[idx] && (
                                <Box 
                                  ml="2"
                                  style={{
                                    backgroundColor: 'var(--accent-9)',
                                    padding: '2px 6px',
                                    borderRadius: '3px',
                                    fontSize: '11px',
                                    cursor: 'pointer'
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    scrollToLogEntry(toolCallTracker[idx]);
                                  }}
                                >
                                  <Text size="1" style={{ color: 'white' }}>
                                    📋 View in Log
                                  </Text>
                                </Box>
                              )}
                            </Flex>
                            {!collapsedToolState[idx] && (
                              <pre style={{ ...preStyle, marginTop: '8px' }}>
                                {msg.content}
                              </pre>
                            )}
                          </Box>
                        ) : (
                          <>
                            {msg.content && (
                              <pre style={preStyle}>
                                {msg.content}
                              </pre>
                            )}
                            {msg.tool_calls && (
                              <Box 
                                mb="2" 
                                style={{
                                  backgroundColor: 'var(--accent-9)',
                                  padding: '8px 12px',
                                  borderRadius: '4px',
                                  display: 'inline-block'
                                }}
                              >
                                <Text size="2" style={{ color: 'white' }}>
                                  🔧 Function Call: {msg.tool_calls[0].function.name}
                                </Text>
                                <pre style={{ ...preStyle, marginTop: '8px' }}>
                                  {msg.tool_calls[0].function.arguments}
                                </pre>
                              </Box>
                            )}
                          </>
                        )}
                      </Box>
                      );
                    })}
                  </Flex>
                </ScrollArea>
                <Flex gap="3" mt="4" justify="end">
                  <Dialog.Close>
                    <Button variant="soft" color="gray">
                      Close
                    </Button>
                  </Dialog.Close>
                </Flex>
              </Dialog.Content>
            </Dialog.Root>

            {/* Main Content */}
            <Flex direction="column" gap="8" style={{ gridColumn: 'span 1' }}>
              {/* Live Feed */}
              <Card>
                <Flex direction="column" gap="4">
                  <Text size="5" weight="bold">Live Browser Feed</Text>
                  <Box style={{ position: 'relative', aspectRatio: '4/3', minHeight: '400px', backgroundColor: 'var(--color-panel)' }}>
                    {imgSrc ? (
                      <Image
                        src={imgSrc}
                        alt="Live Feed"
                        fill
                        style={{ objectFit: 'contain' }}
                      />
                    ) : (
                      <Flex align="center" justify="center" style={{ position: 'absolute', inset: 0 }}>
                        <Text color="gray">Connecting to feed...</Text>
                      </Flex>
                    )}
                  </Box>
                </Flex>
              </Card>

              {/* Logs */}
              <Card>
                <Flex direction="column" gap="4">
                  <Text size="5" weight="bold">Activity Log</Text>
                  <ScrollArea style={{ maxHeight: '400px' }}>
                    <Flex direction="column" gap="2">
                      {log.map((entry, i) => (
                        <Box 
                          key={i} 
                          ref={entry.toolCallId ? (el: HTMLDivElement | null) => {
                            if (el) logEntryRefs.current[entry.toolCallId!] = el;
                          } : undefined}
                          p="4" 
                          style={{ 
                          backgroundColor: 'var(--color-panel)',
                          borderRadius: '6px',
                          border: '1px solid var(--gray-6)'
                        }}>
                          <Flex direction="column" gap="2">
                            <Flex justify="between" align="center">
                              <Text 
                                size="2" 
                                weight="bold"
                                color={
                                  entry.type === 'tool_use' ? 'blue' :
                                  entry.type === 'tool_result' ? 'green' :
                                  entry.type === 'navigation' ? 'purple' :
                                  'red'
                                }
                              >
                                {entry.title}
                              </Text>
                              <Text size="1" color="gray">
                                {new Date(entry.timestamp).toLocaleTimeString()}
                              </Text>
                            </Flex>
                            <Box style={{
                              backgroundColor: 'var(--gray-3)',
                              padding: '8px',
                              borderRadius: '4px',
                              fontFamily: 'monospace',
                              fontSize: '12px'
                            }}>
                              {(() => {
                                switch (entry.type) {
                                  case 'tool_use':
                                    return (
                                      <>
                                        <Text>🔧 Using: {entry.content.name}</Text>
                                        <Box mt="2">
                                          <Text>Input:</Text>
                                          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                                            {JSON.stringify(entry.content.input, null, 2)}
                                          </pre>
                                        </Box>
                                      </>
                                    );
                                  case 'tool_result':
                                    // Title already indicates "Tool Result" or "Tool Error"
                                    // entry.content is MyToolExecutionResult
                                    return (
                                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                                        {JSON.stringify(entry.content, null, 2)}
                                      </pre>
                                    );
                                  case 'navigation':
                                  case 'error':
                                    // entry.content is string
                                    return (
                                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                                        {entry.content}
                                      </pre>
                                    );
                                  default:
                                    // Should not happen with a discriminated union
                                    return <pre>Invalid log entry content</pre>;
                                }
                              })()}
                            </Box>
                          </Flex>
                        </Box>
                      ))}
                      <div ref={logEndRef} style={{ height: 1 }} />
                    </Flex>
                  </ScrollArea>
                </Flex>
              </Card>
            </Flex>
          </Grid>
        </Flex>
      </Box>
    </Theme>
  );
}
