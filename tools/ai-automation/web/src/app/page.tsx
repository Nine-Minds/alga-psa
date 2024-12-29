"use client";
import React, { useEffect, useState } from 'react';
import io from 'socket.io-client';
import Image from 'next/image';
import { Box, Flex, Grid, Text, TextArea, Button, Card, ScrollArea } from '@radix-ui/themes';
import { Theme } from '@radix-ui/themes';

export default function ControlPanel() {
  interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
  }

  const [imgSrc, setImgSrc] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [scriptInput, setScriptInput] = useState('');
  const [userMessage, setUserMessage] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  
  useEffect(() => {
    // Initialize with system message
    setMessages([{
      role: 'system',
      content: 'You are a helpful assistant that generates Puppeteer scripts.'
    }]);
  }, []);

  useEffect(() => {
    const socket = io('http://localhost:4000');
    socket.on('connect', () => console.log('WS connected'));
    socket.on('screenshot', (data: string) => {
      setImgSrc(`data:image/png;base64,${data}`);
    });
    socket.on('disconnect', () => console.log('WS disconnected'));
    return () => { socket.disconnect(); };
  }, []);

  const sendMessageToAI = async () => {
    if (!userMessage.trim()) return;

    // Keep all previous messages for context
    const newMessages: ChatMessage[] = [
      ...messages,
      {
        role: 'user' as const,
        content: userMessage.trim(),
      },
    ];
    setMessages(newMessages);
    setUserMessage('');
    setIsGenerating(true);

    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages }),
      });
      const data = await res.json();
      
      // Parse the response blocks
      const responseBlocks = data.reply.split('\n');
      
      // Add each response block as a separate message
      const updatedMessages = [...newMessages];
      
      for (const block of responseBlocks) {
        if (block.startsWith('[Tool Use:')) {
          // Add tool use as assistant message
          updatedMessages.push({
            role: 'assistant' as const,
            content: block
          });
        } else if (block.trim()) {
          // Add non-empty text blocks as assistant messages
          updatedMessages.push({
            role: 'assistant' as const,
            content: block
          });
        }
      }
      
      setMessages(updatedMessages);

      // Try to find and parse any code blocks in the response
      for (const block of responseBlocks) {
        try {
          const parsed = JSON.parse(block);
          if (parsed.code) {
            setScriptInput(parsed.code);
            setLog(prev => [...prev, 'Extracted code from AI reply.']);
            break;
          }
        } catch {
          // Skip blocks that aren't valid JSON
          continue;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      setLog(prev => [...prev, `Error from AI: ${errorMessage}`]);
    } finally {
      setIsGenerating(false);
    }
  };

  const runScript = async (code: string) => {
    const res = await fetch('/server/api/script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const data = await res.json();
    setLog(prev => [...prev, JSON.stringify(data)]);
  };

  return (
    <Theme appearance="dark" accentColor="purple" grayColor="slate">
      <Box p="8" style={{ minHeight: '100vh', backgroundColor: 'var(--color-background)' }}>
        <Flex direction="column" gap="8" style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <Text size="8" weight="bold">AI Automation Control Panel</Text>
          
          <Grid columns={{ initial: '1', lg: '4' }} gap="8">
            {/* Sidebar */}
            <Flex direction="column" gap="4" style={{ gridColumn: 'span 1' }}>
              <Card>
                <Flex direction="column" gap="4">
                  <Text size="5" weight="bold">Chat with AI</Text>
                  <ScrollArea style={{ maxHeight: '300px', backgroundColor: 'var(--color-panel)' }}>
                    <Flex direction="column" gap="2" p="2">
                      {messages.map((msg, idx) => (
                        <Box key={idx}>
                          <Text color={msg.role === 'user' ? 'blue' : 'green'}>
                            <strong>{msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'AI' : 'System'}:</strong>
                          </Text>
                          <Text size="2" style={{ whiteSpace: 'pre-wrap' }}>
                            {msg.content}
                          </Text>
                        </Box>
                      ))}
                    </Flex>
                  </ScrollArea>

                  <TextArea
                    value={userMessage}
                    onChange={(e) => setUserMessage(e.target.value)}
                    rows={3}
                    placeholder="Type your message here..."
                    style={{ backgroundColor: 'var(--color-panel)' }}
                  />
                  <Button 
                    onClick={sendMessageToAI} 
                    disabled={isGenerating}
                    style={{ width: '100%' }}
                  >
                    {isGenerating ? 'Thinking...' : 'Send'}
                  </Button>

                  <Flex direction="column" gap="3">
                    <Text as="label" size="2" weight="medium">Script Input</Text>
                    <TextArea
                      value={scriptInput}
                      onChange={(e) => setScriptInput(e.target.value)}
                      rows={4}
                      placeholder="Enter JavaScript code"
                      style={{ backgroundColor: 'var(--color-panel)' }}
                    />
                  </Flex>
                  
                  <Button 
                    onClick={() => runScript(scriptInput)}
                    style={{ width: '100%' }}
                  >
                    Execute Script
                  </Button>
                </Flex>
              </Card>
            </Flex>

            {/* Main Content */}
            <Flex direction="column" gap="8" style={{ gridColumn: 'span 3' }}>
              {/* Live Feed */}
              <Card>
                <Flex direction="column" gap="4">
                  <Text size="5" weight="bold">Live Browser Feed</Text>
                  <Box style={{ position: 'relative', aspectRatio: '16/9', backgroundColor: 'var(--color-panel)' }}>
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
                        <Box key={i} p="2" style={{ backgroundColor: 'var(--color-panel)' }}>
                          <Text size="2">{entry}</Text>
                        </Box>
                      ))}
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
