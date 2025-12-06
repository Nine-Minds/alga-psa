'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/Button';

// Dynamic import for xterm to avoid SSR issues
let Terminal: typeof import('xterm').Terminal | null = null;
let FitAddon: typeof import('xterm-addon-fit').FitAddon | null = null;
let WebLinksAddon: typeof import('xterm-addon-web-links').WebLinksAddon | null = null;
let SearchAddon: typeof import('xterm-addon-search').SearchAddon | null = null;

interface RemoteTerminalProps {
  /**
   * WebRTC data channel for terminal communication
   */
  dataChannel: RTCDataChannel | null;

  /**
   * Callback when terminal is closed
   */
  onClose: () => void;

  /**
   * Optional class name for container
   */
  className?: string;
}

type TerminalStatus = 'initializing' | 'connecting' | 'ready' | 'error' | 'closed';

/**
 * RemoteTerminal - xterm.js based terminal for remote shell access
 *
 * Communicates with the remote agent via WebRTC data channel using
 * a simple JSON protocol:
 * - pty-start: Start a new PTY with given dimensions
 * - pty-input: Send input bytes to PTY
 * - pty-output: Receive output bytes from PTY
 * - pty-resize: Resize the PTY
 * - pty-close: Close the PTY
 */
export const RemoteTerminal: React.FC<RemoteTerminalProps> = ({
  dataChannel,
  onClose,
  className = '',
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<InstanceType<typeof import('xterm').Terminal> | null>(null);
  const fitAddonRef = useRef<InstanceType<typeof import('xterm-addon-fit').FitAddon> | null>(null);
  const searchAddonRef = useRef<InstanceType<typeof import('xterm-addon-search').SearchAddon> | null>(null);

  const [status, setStatus] = useState<TerminalStatus>('initializing');
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load xterm modules dynamically
  useEffect(() => {
    const loadModules = async () => {
      try {
        const [xtermModule, fitModule, webLinksModule, searchModule] = await Promise.all([
          import('xterm'),
          import('xterm-addon-fit'),
          import('xterm-addon-web-links'),
          import('xterm-addon-search'),
        ]);

        Terminal = xtermModule.Terminal;
        FitAddon = fitModule.FitAddon;
        WebLinksAddon = webLinksModule.WebLinksAddon;
        SearchAddon = searchModule.SearchAddon;

        setStatus('connecting');
      } catch (error) {
        console.error('Failed to load xterm modules:', error);
        setStatus('error');
      }
    };

    loadModules();
  }, []);

  // Initialize terminal when modules are loaded and data channel is ready
  useEffect(() => {
    if (status !== 'connecting' || !terminalRef.current || !dataChannel || !Terminal || !FitAddon || !WebLinksAddon || !SearchAddon) {
      return;
    }

    // Create terminal instance
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, "Courier New", monospace',
      scrollback: 10000,
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#ffffff',
        cursorAccent: '#1e1e1e',
        selectionBackground: 'rgba(255, 255, 255, 0.3)',
        selectionForeground: '#ffffff',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff',
      },
      allowProposedApi: true,
    });

    // Load addons
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(searchAddon);

    // Open terminal in container
    term.open(terminalRef.current);
    fitAddon.fit();

    // Store refs
    termRef.current = term;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    // Send PTY start message
    const initialSize = {
      cols: term.cols,
      rows: term.rows,
    };

    if (dataChannel.readyState === 'open') {
      dataChannel.send(JSON.stringify({
        type: 'pty-start',
        cols: initialSize.cols,
        rows: initialSize.rows,
      }));
      setStatus('ready');
    } else {
      // Wait for data channel to open
      const handleOpen = () => {
        dataChannel.send(JSON.stringify({
          type: 'pty-start',
          cols: initialSize.cols,
          rows: initialSize.rows,
        }));
        setStatus('ready');
      };
      dataChannel.addEventListener('open', handleOpen, { once: true });
    }

    // Handle incoming PTY output
    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'pty-output' && data.data) {
          // data.data is an array of bytes
          const bytes = new Uint8Array(data.data);
          term.write(bytes);
        } else if (data.type === 'pty-error') {
          term.writeln(`\r\n\x1b[31mError: ${data.message}\x1b[0m`);
        } else if (data.type === 'pty-closed') {
          term.writeln('\r\n\x1b[33mTerminal session ended.\x1b[0m');
          setStatus('closed');
        }
      } catch (e) {
        // Not JSON, might be raw data
        console.warn('Failed to parse terminal message:', e);
      }
    };

    dataChannel.addEventListener('message', handleMessage);

    // Send user input to PTY
    const inputDisposable = term.onData((data) => {
      if (dataChannel.readyState === 'open') {
        const bytes = Array.from(new TextEncoder().encode(data));
        dataChannel.send(JSON.stringify({
          type: 'pty-input',
          data: bytes,
        }));
      }
    });

    // Handle terminal resize
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (dataChannel.readyState === 'open') {
        dataChannel.send(JSON.stringify({
          type: 'pty-resize',
          cols,
          rows,
        }));
      }
    });

    // Window resize handler
    const handleWindowResize = () => {
      fitAddon.fit();
    };
    window.addEventListener('resize', handleWindowResize);

    // Container resize observer
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    // Focus terminal
    term.focus();

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleWindowResize);
      resizeObserver.disconnect();
      dataChannel.removeEventListener('message', handleMessage);
      inputDisposable.dispose();
      resizeDisposable.dispose();

      // Send close message
      if (dataChannel.readyState === 'open') {
        dataChannel.send(JSON.stringify({ type: 'pty-close' }));
      }

      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
  }, [status, dataChannel]);

  // Handle search
  const handleSearch = useCallback((direction: 'next' | 'previous') => {
    if (!searchAddonRef.current || !searchQuery) return;

    if (direction === 'next') {
      searchAddonRef.current.findNext(searchQuery, { caseSensitive: false });
    } else {
      searchAddonRef.current.findPrevious(searchQuery, { caseSensitive: false });
    }
  }, [searchQuery]);

  // Keyboard shortcut for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + F for search
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setShowSearch(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
      // Escape to close search
      if (e.key === 'Escape' && showSearch) {
        setShowSearch(false);
        termRef.current?.focus();
      }
      // Enter in search to find next
      if (e.key === 'Enter' && showSearch) {
        e.preventDefault();
        handleSearch(e.shiftKey ? 'previous' : 'next');
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showSearch, handleSearch]);

  // Copy selection on Ctrl+C when text is selected
  const handleCopy = useCallback(() => {
    if (termRef.current?.hasSelection()) {
      const selection = termRef.current.getSelection();
      navigator.clipboard.writeText(selection);
    }
  }, []);

  // Paste from clipboard on Ctrl+V
  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (termRef.current && dataChannel?.readyState === 'open') {
        const bytes = Array.from(new TextEncoder().encode(text));
        dataChannel.send(JSON.stringify({
          type: 'pty-input',
          data: bytes,
        }));
      }
    } catch (e) {
      console.error('Failed to paste:', e);
    }
  }, [dataChannel]);

  const getStatusText = () => {
    switch (status) {
      case 'initializing':
        return 'Loading terminal...';
      case 'connecting':
        return 'Connecting...';
      case 'ready':
        return 'Terminal';
      case 'error':
        return 'Error';
      case 'closed':
        return 'Closed';
      default:
        return 'Terminal';
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'ready':
        return 'text-green-500';
      case 'error':
        return 'text-red-500';
      case 'closed':
        return 'text-gray-500';
      default:
        return 'text-yellow-500';
    }
  };

  return (
    <div className={`flex flex-col h-full bg-[#1e1e1e] rounded-lg overflow-hidden ${className}`}>
      {/* Terminal header */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#2d2d2d] border-b border-[#3e3e3e]">
        <div className="flex items-center gap-2">
          <span className={`text-xs ${getStatusColor()}`}>●</span>
          <span className="text-sm font-medium text-gray-200">
            {getStatusText()}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Search toggle */}
          <Button
            onClick={() => {
              setShowSearch(!showSearch);
              if (!showSearch) {
                setTimeout(() => searchInputRef.current?.focus(), 0);
              }
            }}
            variant="ghost"
            size="sm"
            className="text-gray-400 hover:text-white hover:bg-[#3e3e3e] h-7 w-7 p-0"
            title="Search (Ctrl+F)"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </Button>

          {/* Copy button */}
          <Button
            onClick={handleCopy}
            variant="ghost"
            size="sm"
            className="text-gray-400 hover:text-white hover:bg-[#3e3e3e] h-7 w-7 p-0"
            title="Copy selection"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </Button>

          {/* Paste button */}
          <Button
            onClick={handlePaste}
            variant="ghost"
            size="sm"
            className="text-gray-400 hover:text-white hover:bg-[#3e3e3e] h-7 w-7 p-0"
            title="Paste"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </Button>

          {/* Close button */}
          <Button
            onClick={onClose}
            variant="ghost"
            size="sm"
            className="text-gray-400 hover:text-white hover:bg-[#3e3e3e] h-7 w-7 p-0"
            title="Close terminal"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </Button>
        </div>
      </div>

      {/* Search bar */}
      {showSearch && (
        <div className="flex items-center gap-2 px-3 py-2 bg-[#252526] border-b border-[#3e3e3e]">
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="flex-1 bg-[#3c3c3c] text-gray-200 text-sm px-2 py-1 rounded border border-[#3e3e3e] focus:outline-none focus:border-blue-500"
          />
          <Button
            onClick={() => handleSearch('previous')}
            variant="ghost"
            size="sm"
            className="text-gray-400 hover:text-white hover:bg-[#3e3e3e] h-7 w-7 p-0"
            title="Previous (Shift+Enter)"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </Button>
          <Button
            onClick={() => handleSearch('next')}
            variant="ghost"
            size="sm"
            className="text-gray-400 hover:text-white hover:bg-[#3e3e3e] h-7 w-7 p-0"
            title="Next (Enter)"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </Button>
          <Button
            onClick={() => {
              setShowSearch(false);
              termRef.current?.focus();
            }}
            variant="ghost"
            size="sm"
            className="text-gray-400 hover:text-white hover:bg-[#3e3e3e] h-7 w-7 p-0"
            title="Close search (Esc)"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </Button>
        </div>
      )}

      {/* Terminal container */}
      <div
        ref={terminalRef}
        className="flex-1 p-2 overflow-hidden"
        onClick={() => termRef.current?.focus()}
      />

      {/* Error/Loading overlays */}
      {status === 'initializing' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#1e1e1e] bg-opacity-90">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2" />
            <p className="text-gray-400 text-sm">Loading terminal...</p>
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#1e1e1e] bg-opacity-90">
          <div className="text-center">
            <svg className="w-12 h-12 text-red-500 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-gray-400 text-sm">Failed to load terminal</p>
            <Button onClick={onClose} variant="outline" size="sm" className="mt-2">
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default RemoteTerminal;
