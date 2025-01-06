"use client";
import React, { useEffect, useState, useRef } from 'react';
import { ArrowRight, Eye } from 'lucide-react';
import io from 'socket.io-client';
import Image from 'next/image';
import { Box, Flex, Grid, Text, TextArea, Button, Card, ScrollArea, Dialog } from '@radix-ui/themes';
import { Theme } from '@radix-ui/themes';
import { prompts } from '../tools/prompts';

import { ChatMessage } from '../types/messages';

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
  }

  const [imgSrc, setImgSrc] = useState('');
  const [log, setLog] = useState<LogEntry[]>([]);
  const [userMessage, setUserMessage] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [showContext, setShowContext] = useState(false);
  const [url, setUrl] = useState('http://server:3000');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

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
      },
      // {
      //   role: 'assistant',
      //   content: 'Welcome to the AI Automation Control Panel! 👋\n\nI can help you interact with web applications by:\n• Navigating pages\n• Finding and clicking elements\n• Filling out forms\n• Extracting information\n• And more!\n\nJust tell me what you\'d like to do and I\'ll guide you through it.'
      // }
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
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsGenerating(false);
  };

  const clearConversation = () => {
    const systemPrompt = prompts.systemMessage
      .replace('{url}', url)
      .replace('{username}', username || '[Not provided]')
      .replace('{password}', password || '[Not provided]');
    
    setMessages([
      {
        role: 'system',
        content: systemPrompt
      },
      // {
      //   role: 'assistant',
      //   content: 'Welcome to the AI Automation Control Panel! 👋\n\nI can help you interact with web applications by:\n• Navigating pages\n• Finding and clicking elements\n• Filling out forms\n• Extracting information\n• And more!\n\nJust tell me what you\'d like to do and I\'ll guide you through it.'
      // }
    ]);
    setIsGenerating(false);
    setUserMessage('');
  };

  const sendMessageToAI = async () => {
    if (!userMessage.trim()) return;
    setIsGenerating(true);

    // Add the user message
    const newMessages: ChatMessage[] = [
      ...messages,
      { role: 'user', content: userMessage.trim() },
    ];
    setMessages(newMessages);
    setUserMessage('');

    try {
      // Set up EventSource for SSE with the messages as query params
      const queryParams = new URLSearchParams({
        messages: JSON.stringify(newMessages)
      });
      eventSourceRef.current = new EventSource(`/api/ai?${queryParams.toString()}`);
      const eventSource = eventSourceRef.current;
      // Handle incoming events
      eventSource.onmessage = (event) => {
        console.log('Received SSE message:', event);
      };

      let currentAssistantMessage = '';
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
                currentAssistantMessage += parsed.data;
                setMessages(prev => {
                  const updated = [...prev];
                  const lastIndex = updated.length - 1;
                  if (lastIndex >= 0 && updated[lastIndex].role === 'assistant') {
                    updated[lastIndex].content = currentAssistantMessage;
                  } else {
                    updated.push({
                      role: 'assistant',
                      content: currentAssistantMessage
                    });
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
          
          // If buffer gets too large, clear it to prevent memory issues
          // if (tokenBuffer.length > 10000) {
          //   console.warn('Token buffer overflow, clearing buffer');
          //   tokenBuffer = '';
          // }
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

      let toolUsePromiseResolve: ((value: unknown) => void) | null = null;
      let currentToolUsePromise: Promise<unknown> | null = null;

      eventSource.addEventListener('tool_use', async (event) => {
        try {
          // Create a new promise for this tool use
          currentToolUsePromise = new Promise(resolve => {
            toolUsePromiseResolve = resolve;
          });

          const toolEvent = cleanAndParseJSON(event.data);
          if (!toolEvent) {
            console.error('Invalid tool use event data');
            return;
          }
          console.log('Tool use requested:', toolEvent);

          let toolData;
          try {
            toolData = cleanAndParseJSON(toolEvent.data);
          } catch (error) {
            console.warn('Failed to parse tool data:', error);
            toolData = toolEvent.data;
          }

          const toolContent = toolData ? {
            name: toolData.name,
            input: toolData.input
          } : toolEvent.data;

          setLog(prev => [...prev, {
            type: 'tool_use',
            title: 'Tool Use Requested',
            content: toolContent,
            timestamp: new Date().toISOString()
          }]);

          // Generate a unique ID for the tool call
          const toolCallId = toolData.tool_use_id;
          
          // Add assistant message with tool call
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: toolCallId,
              type: 'function',
              function: {
                name: toolContent.name,
                arguments: JSON.stringify(toolContent.input)
              }
            }]
          }]);

          // Wait for the tool result before continuing
          await currentToolUsePromise;
        } catch (error) {
          console.error('Error handling tool use event:', error);
          setLog(prev => [...prev, {
            type: 'error',
            title: 'Tool Use Error',
            content: String(error),
            timestamp: new Date().toISOString()
          }]);

          if (toolUsePromiseResolve) {
            toolUsePromiseResolve(null);
          }
        }
      });

      eventSource.addEventListener('tool_result', async (event) => {
        try {
          const resultEvent = cleanAndParseJSON(event.data);
          if (!resultEvent) {
            console.error('Invalid tool result event data');
            return;
          }
          console.log('Tool result:', resultEvent);

          let resultData;
          try {
            resultData = cleanAndParseJSON(resultEvent.data);
          } catch (error) {
            console.warn('Failed to parse result data:', error);
            resultData = resultEvent.data;
          }

          const resultContent = resultData || resultEvent.data;
          
          setLog(prev => [...prev, {
            type: 'tool_result',
            title: 'Tool Result',
            content: resultContent,
            timestamp: new Date().toISOString()
          }]);

          // Add tool response message and prepare for assistant response
          setMessages(prev => {
            const toolCallId = resultContent.tool_call_id;
            
            if (!toolCallId) {
              console.error('No tool call ID found for tool response');
              return prev;
            }

            // Find the last assistant message index
            // const lastAssistantIndex = prev.length - 1;

            // Create properly typed tool response message
            const toolResponse: ChatMessage = {
              role: 'tool',
              name: resultContent.name,
              tool_call_id: toolCallId,
              content: JSON.stringify(resultContent.content),
              timestamp: new Date().toISOString()
            };
            

            // // Insert the tool response before the last assistant message
            // const newMessages = [
            //   ...prev.slice(0, lastAssistantIndex),
            //   toolResponse,
            //   prev[lastAssistantIndex]
            // ];

            // just append the tool response to the assistant message
            return [...prev, toolResponse];
          });

          // Resolve the current tool use promise
          if (toolUsePromiseResolve) {
            toolUsePromiseResolve(resultContent);
            toolUsePromiseResolve = null;
            currentToolUsePromise = null;
          }
        } catch (error) {
          console.error('Error handling tool result event:', error);
          setLog(prev => [...prev, {
            type: 'error',
            title: 'Tool Result Error',
            content: String(error),
            timestamp: new Date().toISOString()
          }]);
        }
      });

      // Handle errors
      eventSource.onerror = () => {
        // Only log and cleanup if we haven't received a done event
        if (eventSource.readyState !== EventSource.CLOSED) {
          console.error('SSE connection error');
          if (eventSourceRef.current === eventSource) {
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
            setIsGenerating(false);
            resolve(null);
          }
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
                    <Button 
                      variant="ghost" 
                      onClick={() => setShowContext(true)}
                      style={{ padding: '6px' }}
                    >
                      <Eye size={16} />
                    </Button>
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
                                script: `(async () => { await page.goto('http://server:3000'); })();`
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
                      {messages.filter(msg => msg.role === 'assistant' || msg.role === 'user').map((msg, idx) => (
                        <Box key={idx}>
                          <Text color={msg.role === 'user' ? 'blue' : msg.role === 'assistant' ? 'green' : 'gray'} mb="2">
                            <strong>
                              {msg.role === 'user'
                                ? 'User'
                                : msg.role === 'assistant'
                                ? 'AI'
                                : 'System'}
                              :
                            </strong>
                          </Text>
                          {msg.tool_calls && (
                            <Box mb="2" style={{
                              backgroundColor: 'var(--accent-9)',
                              padding: '8px 12px',
                              borderRadius: '4px',
                              display: 'inline-block'
                            }}>
                              <Text size="2" style={{ color: 'white' }}>
                                🔧 Function Call: {msg.tool_calls[0].function.name}
                              </Text>
                            </Box>
                          )}
                          {msg.content ? msg.content.split('\n').map((line: string, lineIdx: number) => (
                            <pre key={lineIdx} style={{ ...preStyle, maxWidth: '100%' }}>
                              {line}
                            </pre>
                          )) : null}
                          <div ref={messagesEndRef} style={{ height: 1 }} />
                        </Box>
                      ))}
                    </Flex>
                  </ScrollArea>

                  <TextArea
                    value={userMessage}
                    onChange={(e) => setUserMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (!e.shiftKey) {
                          e.preventDefault();
                          if (!isGenerating && userMessage.trim()) {
                            sendMessageToAI();
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
                      onClick={sendMessageToAI} 
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
                            {msg.role === 'user'
                              ? 'User'
                              : msg.role === 'assistant'
                              ? 'AI'
                              : 'System'}
                            :
                          </strong>
                        </Text>
                        {msg.content && (
                          <pre style={preStyle}>
                            {msg.content}
                          </pre>
                        )}
                        {msg.tool_calls && (
                          <pre style={preStyle}>
                            Tool Call: {JSON.stringify(msg.tool_calls, null, 2)}
                          </pre>
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
                        <Box key={i} p="4" style={{ 
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
