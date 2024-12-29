"use client";
import React, { useEffect, useState } from 'react';
import io from 'socket.io-client';
import Image from 'next/image';
import { Box, Flex, Grid, Text, TextArea, Button, Card, ScrollArea } from '@radix-ui/themes';
import { Theme } from '@radix-ui/themes';

export default function ControlPanel() {
  const [imgSrc, setImgSrc] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [scriptInput, setScriptInput] = useState('');

  useEffect(() => {
    const socket = io('http://localhost:4000');
    socket.on('connect', () => console.log('WS connected'));
    socket.on('screenshot', (data: string) => {
      setImgSrc(`data:image/png;base64,${data}`);
    });
    socket.on('disconnect', () => console.log('WS disconnected'));
    return () => { socket.disconnect(); };
  }, []);

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
                  <Text size="5" weight="bold">Controls</Text>
                  
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
