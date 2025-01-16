"use client";
import React, { useEffect, useState, useRef } from 'react';
import { ArrowRight, Eye, Code } from 'lucide-react';
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
  const [url, setUrl] = useState('http://server:3000');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const logEntryRefs = useRef<{[key: string]: HTMLDivElement | null}>({});
  const currentAssistantMessageRef = useRef<string>('');

  const scrollToLogEntry = (toolCallId: string) => {
    const ref = logEntryRefs.current[toolCallId];
    if (ref) {
      ref.scrollIntoView({ behavior: 'smooth' });
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
    const socket = io('http://localhost:4000');
    socket.on('connect', () => console.log('WS connected'));
    socket.on('screenshot', (data: string) => {
      setImgSrc(`data:image/png;base64,${data}`);
    });
    socket.on('disconnect', () => console.log('WS disconnected'));
    return () => { socket.disconnect(); };
  }, []);

  const cancelGeneration = () => {
    console.log('Cancelling generation');
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

  const cleanAssistantMessage = (message: string) => {
    // Remove function call blocks
    const withoutFuncCalls = message.replace(/<func-call[^>]*>[\s\S]*?<\/func-call>/g, '');
    
    // Remove duplicate content that follows function calls
    const withoutDuplicates = withoutFuncCalls.replace(/(<func-call[^>]*>[\s\S]*?<\/func-call>)\s*\1+/g, '$1');
    
    // Trim whitespace and newlines
    return withoutDuplicates.trim();
  };

  const startNewSseSession = (messages: ChatMessage[]) => {
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

    const queryParams = new URLSearchParams({
      messages: JSON.stringify(filteredMessages)
    });

    console.log('Starting new SSE session');
    eventSourceRef.current = new EventSource(`/api/ai?${queryParams.toString()}`);
    return eventSourceRef.current;
  };

  const sendMessagesToAI = async (messages: ChatMessage[]) => {
    setIsGenerating(true);
    setUserMessage('');

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
          console.log('Received tool use event:', event);
          const toolEvent = cleanAndParseJSON(event.data);
          if (!toolEvent) {
            console.error('Invalid tool use event data');
            return;
          }
          console.log('Tool use requested:', toolEvent);

          const toolData = cleanAndParseJSON(toolEvent.data);
          if (!toolData) {
            throw new Error('Invalid tool data');
          }

          const toolContent = {
            name: toolData.name,
            input: toolData.input
          };
          const toolCallId = toolData.tool_use_id;

          // Log the tool use
          setLog(prev => [...prev, {
            type: 'tool_use',
            title: 'Tool Use Requested',
            content: toolContent,
            timestamp: new Date().toISOString(),
            toolCallId: toolCallId
          }]);

          // Execute the tool
          const result = await invokeTool(toolContent.name, toolContent.input);
          
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
          setIsGenerating(false);
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
                            const response = await fetch('http://localhost:4000/api/ui-state');
                            if (!response.ok) {
                              throw new Error('Failed to fetch UI state');
                            }
                            const data = await response.json();
                            setUIStateData(data);
                            setShowUIState(true);
                          } catch (error) {
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
                            const response = await fetch('http://localhost:4000/api/puppeteer', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                script: `(async () => { await helper.navigate('http://server:3000'); })();`
                              })
                            });
                            if (!response.ok) {
                              throw new Error('Navigation failed');
                            }
                            setLog(prev => [...prev, {
                              type: 'navigation',
                              title: 'Navigation',
                              content: `Navigated to: ${url}`,
                              timestamp: new Date().toISOString()
                            }]);
                          } catch (error: unknown) {
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
                      {messages.filter(msg => msg.role !== 'system').map((msg, idx) => (
                        <Box key={idx}>
                          <Text color={msg.role === 'user' ? 'blue' : msg.role === 'assistant' ? 'green' : 'gray'} mb="2">
                            <strong>
                              {msg.role === 'user' ? 'User' 
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
                              <Text size="2" style={{ color: 'var(--accent-9)' }}>
                                Function: {msg.name}
                              </Text>
                              <pre style={{ ...preStyle, maxWidth: '100%' }}>
                                {msg.content}
                              </pre>
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
                      ))}
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
                        const response = await fetch('http://localhost:4000/api/puppeteer', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            script: codeToExecute
                          })
                        });
                        if (!response.ok) {
                          throw new Error('Code execution failed');
                        }
                        setLog(prev => [...prev, {
                          type: 'tool_use',
                          title: 'Code Execution',
                          content: `Executed code:\n${codeToExecute}`,
                          timestamp: new Date().toISOString()
                        }]);
                        setShowCodeExecution(false);
                      } catch (error: unknown) {
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
                    {messages.map((msg, idx) => (
                      <Box key={idx}>
                        <Text color={msg.role === 'user' ? 'blue' : msg.role === 'assistant' ? 'green' : 'gray'} mb="2">
                          <strong>
                            {msg.role === 'user' ? 'User'
                             : msg.role === 'assistant' ? 'AI'
                             : msg.role === 'tool' ? 'Tool Response'
                             : 'System'}
                            :
                          </strong>
                        </Text>
                        {msg.role === 'tool' ? (
                          <Box mb="2">
                            <Text size="2" style={{ color: 'var(--accent-9)' }}>
                              Function: {msg.name}
                            </Text>
                            <pre style={preStyle}>
                              {msg.content}
                            </pre>
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
                    ))}
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
