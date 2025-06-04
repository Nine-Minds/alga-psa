"use client";
import React, { useEffect, useState, useRef } from 'react';
import { ArrowRight, Eye, Code, ExternalLink, Monitor } from 'lucide-react';
import io from 'socket.io-client';
import Image from 'next/image';
import { Box, Flex, Grid, Text, TextArea, Button, Card, ScrollArea, Dialog } from '@radix-ui/themes';
import { Theme } from '@radix-ui/themes';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { prompts } from '../tools/prompts';
import { invokeTool } from '../tools/invokeTool';
import { ChatMessage } from '../types/messages';

type JsonValue = 
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

interface UIStateResponse {
  [key: string]: JsonValue;
  page: {
    title: string;
    url: string;
  };
  result: JsonValue;
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
    input?: unknown;
  }

  interface LogEntry {
    type: 'tool_use' | 'tool_result' | 'navigation' | 'error';
    title: string;
    content: string | ToolContent | unknown;
    timestamp: string;
    toolCallId?: string;
  }

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
  const [browserStatus, setBrowserStatus] = useState<{
    currentSessionId: string;
    activeSessionId: string | null;
    sessionCount: number;
    sessions: Array<{ id: string; mode: 'headless' | 'headed'; url: string; wsEndpoint?: string }>;
  } | null>(null);
  const [isPopOutMode, setIsPopOutMode] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const logEntryRefs = useRef<{[key: string]: HTMLDivElement | null}>({});
  const currentAssistantMessageRef = useRef<string>('');
  const isCancelledRef = useRef<boolean>(false);

  const scrollToLogEntry = (toolCallId: string) => {
    const ref = logEntryRefs.current[toolCallId];
    if (ref) {
      // Get the ScrollArea container
      const scrollContainer = ref.closest('[data-radix-scroll-area-viewport]');
      
      if (scrollContainer) {
        // Calculate the position to scroll to (top of the element with some offset)
        const containerRect = scrollContainer.getBoundingClientRect();
        const elementRect = ref.getBoundingClientRect();
        const scrollTop = scrollContainer.scrollTop;
        
        // Calculate the target scroll position (element top - container top + current scroll - offset)
        const targetScrollTop = scrollTop + (elementRect.top - containerRect.top) - 20;
        
        // Smooth scroll to the calculated position
        scrollContainer.scrollTo({
          top: Math.max(0, targetScrollTop),
          behavior: 'smooth'
        });
      } else {
        // Fallback to original method
        ref.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      
      // Add visual highlight effect
      ref.style.backgroundColor = 'var(--accent-3)';
      ref.style.transition = 'background-color 0.3s ease';
      
      // Remove highlight after 2 seconds
      setTimeout(() => {
        ref.style.backgroundColor = '';
      }, 2000);
    }
  };

  const scrollMessagesToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Auto-scroll when messages update
  const scrollLogToBottom = () => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollMessagesToBottom();
  }, [messages]);

  useEffect(() => {
    scrollLogToBottom();
  }, [log]);

  // Set tool responses to be collapsed by default
  useEffect(() => {
    const filteredMessages = messages.filter(msg => msg.role !== 'system');
    const newCollapsedState: CollapsedToolState = {};
    
    filteredMessages.forEach((msg, idx) => {
      const isToolResult = msg.role === 'user' && msg.content && 
        (msg.content.startsWith('{') || msg.content.startsWith('['));
      const isToolMessage = msg.role === 'tool';
      
      if ((isToolResult || isToolMessage) && !(idx in collapsedToolState)) {
        newCollapsedState[idx] = true; // Collapsed by default
      }
    });
    
    if (Object.keys(newCollapsedState).length > 0) {
      setCollapsedToolState(prev => ({ ...prev, ...newCollapsedState }));
    }
  }, [messages, collapsedToolState]);

  // Styles for message formatting
  const preStyle: React.CSSProperties = {
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    background: 'var(--color-panel)',
    padding: '8px',
    borderRadius: '4px',
    margin: '4px 0'
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px',
    backgroundColor: 'var(--color-panel)',
    border: 'none',
    borderRadius: '4px',
    color: 'inherit',
    fontSize: 'inherit',
    outline: 'none'
  };

  useEffect(() => {
    const systemPrompt = prompts.systemMessage
      .replace('{url}', url)
      .replace('{username}', username || '[Not provided]')
      .replace('{password}', password || '[Not provided]');
    
    setMessages([
      {
        role: 'system',
        content: systemPrompt
      }
    ]);
  }, [url, username, password]);

  useEffect(() => {
    console.log('=== Socket.IO Configuration ===');
    console.log('Origin:', window.location.origin);
    console.log('Environment:', process.env.NODE_ENV);
    console.log('================================');
    
    // Connect to Socket.IO through the same origin (proxied by Next.js)
    const socket = io({
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });
    
    socket.on('connect', () => {
      console.log('✅ WebSocket connected');
      console.log('Socket ID:', socket.id);
      console.log('Transport:', socket.io.engine.transport.name);
    });
    
    socket.on('connect_error', (error) => {
      console.error('❌ WebSocket connection error:', error.message);
      console.error('Error type:', error.type);
      console.error('Error details:', error);
    });
    
    socket.on('screenshot', (data: string) => {
      console.log('📸 Screenshot received, size:', data.length);
      setImgSrc(`data:image/png;base64,${data}`);
    });
    
    socket.on('disconnect', (reason) => {
      console.log('🔌 WebSocket disconnected:', reason);
      if (reason === 'io server disconnect') {
        console.log('Server initiated disconnect, attempting reconnect...');
        socket.connect();
      }
    });
    
    socket.on('reconnect', (attemptNumber) => {
      console.log('🔄 WebSocket reconnected after', attemptNumber, 'attempts');
    });
    
    socket.on('reconnect_error', (error) => {
      console.error('❌ WebSocket reconnection error:', error);
    });
    
    return () => { 
      console.log('🧹 Cleaning up WebSocket connection');
      socket.disconnect(); 
    };
  }, []);

  // Fetch browser status on component mount and periodically
  useEffect(() => {
    fetchBrowserStatus();
    const interval = setInterval(fetchBrowserStatus, 5000); // Check every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const cancelGeneration = () => {
    console.log('Cancelling generation');
    isCancelledRef.current = true;
    if (eventSourceRef.current) {
      console.log('Closing SSE connection for cancellation');
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsGenerating(false);
    // Reset current assistant message if it's empty
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
    isCancelledRef.current = false; // Reset cancellation flag
    // Close any existing SSE connection
    if (eventSourceRef.current) {
      console.log('Closing SSE connection for conversation clear');
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    
    const systemPrompt = prompts.systemMessage
      .replace('{url}', url)
      .replace('{username}', username || '[Not provided]')
      .replace('{password}', password || '[Not provided]');
    
    setMessages([
      {
        role: 'system',
        content: systemPrompt
      }
    ]);
    setIsGenerating(false);
    setUserMessage('');
    // Clear the log as well since we're starting fresh
    setLog([]);
  };

  const fetchBrowserStatus = async () => {
    try {
      console.log('[CLIENT] Fetching browser status from /api/browser/status (proxy to backend)');
      const response = await fetch('/api/browser/status');
      console.log('[CLIENT] Browser status response:', response.status, response.statusText);
      if (response.ok) {
        const status = await response.json();
        console.log('[CLIENT] Browser status data:', status);
        setBrowserStatus(status);
        // Determine if we're in pop out mode based on current session
        const currentSession = status.sessions.find((s: { id: string; mode: 'headless' | 'headed' }) => s.id === status.currentSessionId);
        setIsPopOutMode(currentSession?.mode === 'headed');
      }
    } catch (error) {
      console.error('[CLIENT] Error fetching browser status:', error);
    }
  };

  const handlePopOut = async () => {
    try {
      console.log('[CLIENT] Calling /api/browser/pop-out (proxy to backend)');
      const response = await fetch('/api/browser/pop-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      console.log('[CLIENT] Pop-out response:', response.status, response.statusText);
      
      if (response.ok) {
        const result = await response.json();
        console.log('[CLIENT] Pop-out result:', result);
        setLog(prev => [...prev, {
          type: 'navigation',
          title: 'Browser Popped Out',
          content: `Browser is now running in headed mode. Session: ${result.sessionId}`,
          timestamp: new Date().toISOString()
        }]);
        setIsPopOutMode(true);
        await fetchBrowserStatus();
      } else {
        throw new Error('Failed to pop out browser');
      }
    } catch (error) {
      console.error('[CLIENT] Pop-out error:', error);
      setLog(prev => [...prev, {
        type: 'error',
        title: 'Pop Out Error',
        content: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      }]);
    }
  };

  const handlePopIn = async () => {
    try {
      console.log('[CLIENT] Calling /api/browser/pop-in (proxy to backend)');
      const response = await fetch('/api/browser/pop-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      console.log('[CLIENT] Pop-in response:', response.status, response.statusText);
      
      if (response.ok) {
        const result = await response.json();
        console.log('[CLIENT] Pop-in result:', result);
        setLog(prev => [...prev, {
          type: 'navigation',
          title: 'Browser Popped In',
          content: `Browser is now running in headless mode. Session: ${result.sessionId}`,
          timestamp: new Date().toISOString()
        }]);
        setIsPopOutMode(false);
        await fetchBrowserStatus();
      } else {
        throw new Error('Failed to pop in browser');
      }
    } catch (error) {
      console.error('[CLIENT] Pop-in error:', error);
      setLog(prev => [...prev, {
        type: 'error',
        title: 'Pop In Error',
        content: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      }]);
    }
  };

  const cleanAssistantMessage = (message: string) => {
    // Remove function call blocks
    const withoutFuncCalls = message.replace(/<func-call[^>]*>[\s\S]*?<\/func-call>/g, '');
    
    // Remove duplicate content that follows function calls
    const withoutDuplicates = withoutFuncCalls.replace(/(<func-call[^>]*>[\s\S]*?<\/func-call>)\s*\1+/g, '$1');
    
    // Trim whitespace and newlines
    return withoutDuplicates.trim();
  };

  const startNewSseSession = (messages: ChatMessage[]) => {
    // Check if cancelled before starting new session
    if (isCancelledRef.current) {
      console.log('Session cancelled, not starting new SSE connection');
      return null;
    }
    
    // Close any existing SSE connection first
    if (eventSourceRef.current) {
      console.log('Closing existing SSE connection before starting new one');
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    
    // Reset the current assistant message
    currentAssistantMessageRef.current = '';

    // Filter out empty messages and clean assistant messages
    const filteredMessages = messages
      .filter(msg => {
        if (msg.role === 'system') return true;
        if (msg.role === 'assistant' && !msg.content && !msg.tool_calls) return false;
        if (!msg.content && !msg.tool_calls) return false;
        return true;
      })
      .map(msg => {
        if (msg.role === 'assistant' && msg.content) {
          return {
            ...msg,
            content: msg.content
          };
        }
        return msg;
      });

    // TODO: This should be refactored to use POST requests to avoid 431 errors
    // when message history gets long. EventSource only supports GET, so we'd need
    // to switch to fetch() with manual streaming or use WebSockets
    const queryParams = new URLSearchParams({
      messages: JSON.stringify(filteredMessages)
    });

    console.log('[CLIENT] Starting new SSE session to /api/ai (proxy to backend)');
    console.log('[CLIENT] Message count:', filteredMessages.length);
    console.log('[CLIENT] Query params size:', queryParams.toString().length, 'bytes');
    eventSourceRef.current = new EventSource(`/api/ai?${queryParams.toString()}`);
    console.log('[CLIENT] SSE connection created');
    return eventSourceRef.current;
  };

  const sendMessagesToAI = async (messages: ChatMessage[]) => {
    setIsGenerating(true);
    setUserMessage('');
    isCancelledRef.current = false; // Reset cancellation flag when starting new generation
    
    let hasToolCalls = false;

    // Filter messages and add empty assistant slot
    const filteredMessages = messages.filter(msg => {
      // Always keep system messages
      if (msg.role === 'system') return true;
      // Keep assistant messages that have content or tool calls
      if (msg.role === 'assistant') {
        return !!(msg.content || msg.tool_calls);
      }
      // Keep user messages even if they don't have content (like error responses)
      if (msg.role === 'user') return true;
      return false;
    });
    setMessages([...filteredMessages, { role: 'assistant', content: '' }]);

    try {
      const eventSource = startNewSseSession(filteredMessages);
      
      // If session was cancelled, don't proceed
      if (!eventSource) {
        setIsGenerating(false);
        return;
      }

      // Handle incoming events
      eventSource.onmessage = (event) => {
        console.log('Received SSE message:', event);
      };

      let tokenBuffer = '';

      eventSource.addEventListener('token', (event) => {
        try {
          // Add new data to the buffer
          tokenBuffer += event.data;
          
          // Try to extract complete token objects
          let match;
          const tokenRegex = /\{"type":"token","data":"((?:[^"\\]|\\.)*)"\}/g;
          
          while ((match = tokenRegex.exec(tokenBuffer)) !== null) {
            try {
              const token = match[0];
              const parsed = JSON.parse(token);
              
              if (parsed.data) {
                currentAssistantMessageRef.current += parsed.data;
                setMessages(prev => {
                  const updated = [...prev];
                  const lastMessage = updated[updated.length - 1];
                  if (lastMessage && lastMessage.role === 'assistant') {
                    lastMessage.content = currentAssistantMessageRef.current;
                  }
                  return updated;
                });
              }
              
              // Remove the processed token from the buffer
              tokenBuffer = tokenBuffer.slice(match.index + token.length);
            } catch (error) {
              // Skip malformed tokens
              console.warn('Skipping malformed token:', match[0], error);
            }
          }
        } catch (error) {
          console.error('Error processing token event:', error);
        }
      });

      const cleanAndParseJSON = (str: string) => {
        try {
          // Remove control characters and escape sequences
          const cleaned = str
            .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
            .replace(/\\[^"\\\/bfnrtu]/g, '');
          return JSON.parse(cleaned);
        } catch (error) {
          console.warn('JSON parse error:', error);
          return null;
        }
      };

      eventSource.addEventListener('tool_use', async (event) => {
        try {
          hasToolCalls = true; // Mark that we have tool calls in this session
          console.log('%c[FRONTEND] 🎯 Received tool use event', 'color: #ff6b6b; font-weight: bold', event);
          const toolEvent = JSON.parse(event.data);
          if (!toolEvent) {
            console.error('%c[FRONTEND] ❌ Invalid tool use event data', 'color: #ff4757');
            return;
          }
          console.log('%c[FRONTEND] 📋 Tool use requested', 'color: #5f27cd; font-weight: bold', toolEvent);

          const toolData = JSON.parse(toolEvent.data);
          if (!toolData) {
            throw new Error('Invalid tool data');
          }

          const toolContent = {
            name: toolData.name,
            input: toolData.input
          };
          const toolCallId = toolData.tool_use_id;
          console.log(`%c[FRONTEND] 🔧 Executing tool: ${toolContent.name}`, 'color: #00d2d3; font-weight: bold', toolContent.input);

          // Log the tool use
          setLog(prev => [...prev, {
            type: 'tool_use',
            title: 'Tool Use Requested',
            content: toolContent,
            timestamp: new Date().toISOString(),
            toolCallId: toolCallId
          }]);

          // Execute the tool
          console.log(`%c[FRONTEND] 🚀 Invoking tool: ${toolContent.name}`, 'color: #ff9ff3; font-weight: bold');
          const result = await invokeTool(toolContent.name, toolContent.input);
          console.log(`%c[FRONTEND] ✅ Tool execution result`, 'color: #54a0ff; font-weight: bold', result);
          
          // Check if cancelled before processing result
          if (isCancelledRef.current) {
            console.log('%c[FRONTEND] ⚠️ Tool execution cancelled, ignoring result', 'color: #ffa502; font-weight: bold');
            setLog(prev => [...prev, {
              type: 'tool_result',
              title: 'Tool Cancelled',
              content: 'Tool execution was cancelled before result could be processed',
              timestamp: new Date().toISOString(),
              toolCallId: toolCallId
            }]);
            return;
          }
          
          // Create tool result message
          const toolResult: ChatMessage = {
            role: 'user',
            content: JSON.stringify(result.success ? result.result : result)
          };

          // Log the result
          setLog(prev => [...prev, {
            type: 'tool_result',
            title: result.success ? 'Tool Result' : 'Tool Error',
            content: result,
            timestamp: new Date().toISOString(),
            toolCallId: toolCallId
          }]);

          // Add tool result to messages and start new SSE session
          setMessages(prev => {
            const updatedMessages = [...prev, toolResult];
            
            // Track the tool call ID and tool name for the new tool result message
            const toolResultIndex = updatedMessages.filter(msg => msg.role !== 'system').length - 1;
            setToolCallTracker(prevTracker => ({
              ...prevTracker,
              [toolResultIndex]: toolCallId
            }));
            setToolNameTracker(prevTracker => ({
              ...prevTracker,
              [toolResultIndex]: toolContent.name
            }));
            
            sendMessagesToAI(updatedMessages);
            return updatedMessages;
          });
        } catch (error) {
          console.error('Error handling tool use event:', error);
          setLog(prev => [...prev, {
            type: 'error',
            title: 'Tool Use Error',
            content: String(error),
            timestamp: new Date().toISOString()
          }]);
        }
      });

      // Handle errors
      eventSource.onerror = (error) => {
        console.error('SSE connection error:', error);
        // Only log and cleanup if we haven't received a done event
        if (eventSource.readyState !== EventSource.CLOSED) {
          if (eventSourceRef.current === eventSource) {
            console.log('Closing SSE connection due to error');
            eventSource.close();
            eventSourceRef.current = null;
            setIsGenerating(false);
          }
        }
      };

      // Wait for the response to complete
      await new Promise((resolve) => {
        eventSource.addEventListener('done', () => {
          console.log('Received done event, closing connection');
          if (eventSourceRef.current === eventSource) {
            eventSource.close();
            eventSourceRef.current = null;
          }
          // Only set isGenerating to false if there were no tool calls in this session
          // If there were tool calls, they will trigger new SSE sessions
          if (!hasToolCalls) {
            console.log('No tool calls detected, ending generation state');
            setIsGenerating(false);
          } else {
            console.log('Tool calls detected, staying in generation state');
          }
          resolve(null);
        });
      });
    } catch (error) {
      console.error('Error in AI processing:', error);
      setLog(prev => [...prev, {
        type: 'error',
        title: 'Error',
        content: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      }]);
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
                            const response = await fetch('/api/puppeteer', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                script: `(async () => { await helper.navigate('${url}'); })();`
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
                    
                    {/* Browser Mode Controls */}
                    <Flex gap="2" align="center">
                      <Text size="2" style={{ color: 'var(--gray-11)' }}>
                        Browser Mode:
                      </Text>
                      <Flex gap="1" align="center">
                        <Box 
                          style={{ 
                            width: '8px', 
                            height: '8px', 
                            borderRadius: '50%', 
                            backgroundColor: isPopOutMode ? '#00d084' : '#ff4757' 
                          }} 
                        />
                        <Text size="2" style={{ color: 'var(--gray-12)', minWidth: '60px' }}>
                          {isPopOutMode ? 'Headed' : 'Headless'}
                        </Text>
                      </Flex>
                      <Button
                        size="1"
                        variant={isPopOutMode ? 'soft' : 'solid'}
                        onClick={isPopOutMode ? handlePopIn : handlePopOut}
                        style={{ 
                          padding: '4px 8px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        {isPopOutMode ? (
                          <>
                            <Monitor size={12} />
                            Pop In
                          </>
                        ) : (
                          <>
                            <ExternalLink size={12} />
                            Pop Out
                          </>
                        )}
                      </Button>
                      {browserStatus && (
                        <Text size="1" style={{ color: 'var(--gray-9)' }}>
                          {browserStatus.sessionCount} session{browserStatus.sessionCount !== 1 ? 's' : ''}
                        </Text>
                      )}
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
                          data={uiStateData}
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
                      
                      const allPaths = getAllPaths(uiStateData);
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
                          type: 'tool_use',
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
                              {entry.type === 'tool_use' && typeof entry.content === 'object' && entry.content !== null && 'name' in entry.content ? (
                                <>
                                  <Text>🔧 Using: {(entry.content as ToolContent).name}</Text>
                                  <Box mt="2">
                                    <Text>Input:</Text>
                                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                                      {JSON.stringify((entry.content as ToolContent).input, null, 2)}
                                    </pre>
                                  </Box>
                                </>
                              ) : entry.type === 'tool_result' && typeof entry.content === 'object' && entry.content !== null && 'name' in entry.content ? (
                                <>
                                  <Text>🔧 Result from: {(entry.content as ToolContent).name}</Text>
                                  <Box mt="2">
                                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                                      {JSON.stringify(entry.content, null, 2)}
                                    </pre>
                                  </Box>
                                </>
                              ) : (
                                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                                  {typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content, null, 2)}
                                </pre>
                              )}
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
