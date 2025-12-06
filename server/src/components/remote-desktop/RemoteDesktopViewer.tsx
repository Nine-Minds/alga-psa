'use client';

import React, { useEffect, useRef, useState, useCallback, lazy, Suspense } from 'react';
import { Button } from '@/components/ui/Button';
import {
  InputEvent,
  KeyEvent,
  MouseButton,
  SpecialKeyComboEvent,
} from '@/types/remoteDesktop';
import { KeyboardHandler } from './KeyboardHandler';
import { SpecialKeysMenu } from './SpecialKeysMenu';

// Lazy load RemoteTerminal to avoid loading xterm.js unless needed
const RemoteTerminal = lazy(() => import('./RemoteTerminal'));

interface RemoteDesktopViewerProps {
  sessionId: string;
  agentId: string;
  signalingUrl?: string;
  onDisconnect?: () => void;
  onError?: (error: string) => void;
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export const RemoteDesktopViewer: React.FC<RemoteDesktopViewerProps> = ({
  sessionId,
  agentId,
  signalingUrl = '/ws/rd-signal',
  onDisconnect,
  onError,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [remoteResolution, setRemoteResolution] = useState<{ width: number; height: number } | null>(null);
  const [keyboardFocused, setKeyboardFocused] = useState(false);
  const [remoteOs, setRemoteOs] = useState<'windows' | 'macos'>('windows');
  const [showTerminal, setShowTerminal] = useState(false);
  const terminalDataChannelRef = useRef<RTCDataChannel | null>(null);

  // Initialize WebSocket and WebRTC connection
  useEffect(() => {
    initializeConnection();

    return () => {
      cleanup();
    };
  }, [sessionId]);

  // Handle fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const initializeConnection = async () => {
    try {
      // Get API key from session storage (should be set by auth system)
      const apiKey = sessionStorage.getItem('api_key') || localStorage.getItem('api_key');

      if (!apiKey) {
        throw new Error('API key not found. Please authenticate first.');
      }

      // Determine WebSocket URL
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsHost = window.location.host;
      const wsUrl = `${wsProtocol}//${wsHost}${signalingUrl}?token=${encodeURIComponent(apiKey)}&role=engineer`;

      // Create WebSocket connection
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log('WebSocket connected');

        // Request session
        wsRef.current?.send(JSON.stringify({
          type: 'session-request',
          sessionId,
          senderId: 'engineer-' + Date.now(),
          payload: {},
          timestamp: Date.now(),
        }));
      };

      wsRef.current.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        await handleSignalingMessage(message);
      };

      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        setStatus('error');
        onError?.('WebSocket connection failed');
      };

      wsRef.current.onclose = () => {
        console.log('WebSocket disconnected');
        if (status !== 'error') {
          setStatus('disconnected');
        }
      };

      // Create WebRTC peer connection
      await createPeerConnection();

    } catch (error) {
      console.error('Failed to initialize connection:', error);
      setStatus('error');
      onError?.(error instanceof Error ? error.message : 'Connection failed');
    }
  };

  const createPeerConnection = async () => {
    const config: RTCConfiguration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    };

    peerConnectionRef.current = new RTCPeerConnection(config);

    // Handle ICE candidates
    peerConnectionRef.current.onicecandidate = (event) => {
      if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'ice-candidate',
          sessionId,
          senderId: 'engineer',
          payload: event.candidate,
          timestamp: Date.now(),
        }));
      }
    };

    // Handle incoming video stream
    peerConnectionRef.current.ontrack = (event) => {
      console.log('Received remote track:', event.track.kind);
      if (videoRef.current && event.streams[0]) {
        videoRef.current.srcObject = event.streams[0];
        setStatus('connected');
      }
    };

    // Monitor connection state
    peerConnectionRef.current.onconnectionstatechange = () => {
      const state = peerConnectionRef.current?.connectionState;
      console.log('Connection state:', state);
      setConnectionState(state || 'new');

      if (state === 'connected') {
        setStatus('connected');
      } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        setStatus('disconnected');
      }
    };

    // Handle incoming data channel (for input events and terminal)
    peerConnectionRef.current.ondatachannel = (event) => {
      console.log('Received data channel:', event.channel.label);
      if (event.channel.label === 'input') {
        dataChannelRef.current = event.channel;
        setupDataChannel(event.channel);
      } else if (event.channel.label === 'terminal') {
        terminalDataChannelRef.current = event.channel;
        setupDataChannel(event.channel);
      }
    };

    // Create data channel for input events (as offerer)
    const inputChannel = peerConnectionRef.current.createDataChannel('input', {
      ordered: true,
    });
    dataChannelRef.current = inputChannel;
    setupDataChannel(inputChannel);

    // Create data channel for terminal (as offerer)
    const terminalChannel = peerConnectionRef.current.createDataChannel('terminal', {
      ordered: true,
    });
    terminalDataChannelRef.current = terminalChannel;
    setupDataChannel(terminalChannel);
  };

  const setupDataChannel = (channel: RTCDataChannel) => {
    channel.onopen = () => {
      console.log('Data channel opened:', channel.label);
    };

    channel.onclose = () => {
      console.log('Data channel closed:', channel.label);
    };

    channel.onerror = (error) => {
      console.error('Data channel error:', error);
    };
  };

  const handleSignalingMessage = async (message: any) => {
    console.log('Signaling message:', message.type);

    switch (message.type) {
      case 'connected':
        console.log('Signaling connection confirmed');
        break;

      case 'session-accept':
        console.log('Session accepted by agent');
        await createOffer();
        break;

      case 'session-deny':
        console.log('Session denied by agent');
        setStatus('error');
        onError?.('Remote user denied the connection request');
        break;

      case 'answer':
        if (peerConnectionRef.current && message.payload) {
          await peerConnectionRef.current.setRemoteDescription(
            new RTCSessionDescription(message.payload)
          );
        }
        break;

      case 'ice-candidate':
        if (peerConnectionRef.current && message.payload) {
          try {
            await peerConnectionRef.current.addIceCandidate(
              new RTCIceCandidate(message.payload)
            );
          } catch (e) {
            console.warn('Failed to add ICE candidate:', e);
          }
        }
        break;

      case 'error':
        console.error('Signaling error:', message.message);
        setStatus('error');
        onError?.(message.message || 'Unknown signaling error');
        break;
    }
  };

  const createOffer = async () => {
    if (!peerConnectionRef.current) return;

    try {
      const offer = await peerConnectionRef.current.createOffer({
        offerToReceiveVideo: true,
        offerToReceiveAudio: false,
      });

      await peerConnectionRef.current.setLocalDescription(offer);

      // Send offer to agent via signaling
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'offer',
          sessionId,
          senderId: 'engineer',
          payload: offer,
          timestamp: Date.now(),
        }));
      }
    } catch (error) {
      console.error('Failed to create offer:', error);
      setStatus('error');
      onError?.('Failed to establish WebRTC connection');
    }
  };

  // Input event handlers
  const sendInputEvent = useCallback((event: InputEvent) => {
    if (dataChannelRef.current?.readyState === 'open') {
      dataChannelRef.current.send(JSON.stringify(event));
    }
  }, []);

  const getScaledCoordinates = useCallback((e: React.MouseEvent<HTMLVideoElement>) => {
    if (!videoRef.current) return { x: 0, y: 0 };

    const video = videoRef.current;
    const rect = video.getBoundingClientRect();

    // Get the actual video dimensions vs displayed dimensions
    const videoWidth = video.videoWidth || 1920;
    const videoHeight = video.videoHeight || 1080;

    // Calculate scale
    const scaleX = videoWidth / rect.width;
    const scaleY = videoHeight / rect.height;

    return {
      x: Math.floor((e.clientX - rect.left) * scaleX),
      y: Math.floor((e.clientY - rect.top) * scaleY),
    };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLVideoElement>) => {
    if (status !== 'connected') return;
    const { x, y } = getScaledCoordinates(e);
    sendInputEvent({ type: 'MouseMove', x, y });
  }, [status, sendInputEvent, getScaledCoordinates]);

  // Map browser button numbers to our MouseButton type
  const getMouseButton = useCallback((buttonNumber: number): MouseButton => {
    switch (buttonNumber) {
      case 0: return 'left';
      case 1: return 'middle';
      case 2: return 'right';
      case 3: return 'back';    // Mouse4 / XButton1
      case 4: return 'forward'; // Mouse5 / XButton2
      default: return 'left';
    }
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLVideoElement>) => {
    if (status !== 'connected') return;
    e.preventDefault();
    const { x, y } = getScaledCoordinates(e);
    const button = getMouseButton(e.button);
    sendInputEvent({ type: 'MouseDown', button, x, y });
  }, [status, sendInputEvent, getScaledCoordinates, getMouseButton]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLVideoElement>) => {
    if (status !== 'connected') return;
    const { x, y } = getScaledCoordinates(e);
    const button = getMouseButton(e.button);
    sendInputEvent({ type: 'MouseUp', button, x, y });
  }, [status, sendInputEvent, getScaledCoordinates, getMouseButton]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLVideoElement>) => {
    if (status !== 'connected') return;
    e.preventDefault();
    sendInputEvent({
      type: 'MouseScroll',
      delta_x: Math.round(e.deltaX),
      delta_y: Math.round(e.deltaY),
      deltaMode: e.deltaMode, // 0=pixels, 1=lines, 2=pages
    });
  }, [status, sendInputEvent]);

  // Enhanced keyboard handler callback
  const handleKeyEvent = useCallback((event: KeyEvent) => {
    if (status !== 'connected') return;
    sendInputEvent(event);
  }, [status, sendInputEvent]);

  // Special keys menu handler
  const handleSpecialKey = useCallback((event: SpecialKeyComboEvent) => {
    if (status !== 'connected') return;
    sendInputEvent(event);
  }, [status, sendInputEvent]);

  // Focus handler for keyboard capture indicator
  const handleKeyboardFocusChange = useCallback((focused: boolean) => {
    setKeyboardFocused(focused);
  }, []);

  const cleanup = () => {
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }
    if (terminalDataChannelRef.current) {
      terminalDataChannelRef.current.close();
      terminalDataChannelRef.current = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  // Handle terminal toggle
  const handleTerminalToggle = useCallback(() => {
    setShowTerminal((prev) => !prev);
  }, []);

  const handleTerminalClose = useCallback(() => {
    setShowTerminal(false);
  }, []);

  const handleDisconnectClick = () => {
    cleanup();
    setStatus('disconnected');
    onDisconnect?.();
  };

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;

    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (e) {
      console.error('Fullscreen error:', e);
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'connected':
        return 'bg-green-500';
      case 'connecting':
        return 'bg-yellow-500';
      case 'error':
        return 'bg-red-500';
      default:
        return 'bg-gray-400';
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'connected':
        return 'Connected';
      case 'connecting':
        return 'Connecting...';
      case 'error':
        return 'Error';
      default:
        return 'Disconnected';
    }
  };

  return (
    <div ref={containerRef} className="flex flex-col h-full bg-black">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${getStatusColor()}`} />
          <span className="text-sm font-medium text-white">
            {getStatusText()}
          </span>
          <span className="text-xs text-gray-400">
            ({connectionState})
          </span>
          {/* Keyboard focus indicator */}
          {status === 'connected' && (
            <span
              className={`text-xs px-2 py-0.5 rounded ${
                keyboardFocused
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-700 text-gray-400'
              }`}
            >
              {keyboardFocused ? 'Keyboard Active' : 'Click to capture keyboard'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Special Keys Menu */}
          <SpecialKeysMenu
            onSpecialKey={handleSpecialKey}
            enabled={status === 'connected'}
            targetOs={remoteOs}
          />

          {/* Terminal Toggle */}
          <Button
            onClick={handleTerminalToggle}
            variant="ghost"
            size="sm"
            className={`text-gray-300 hover:text-white hover:bg-gray-800 ${
              showTerminal ? 'bg-gray-800' : ''
            }`}
            title="Toggle Terminal"
          >
            <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Terminal
          </Button>

          <Button
            onClick={toggleFullscreen}
            variant="ghost"
            size="sm"
            className="text-gray-300 hover:text-white hover:bg-gray-800"
          >
            {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </Button>
          <Button
            onClick={handleDisconnectClick}
            variant="destructive"
            size="sm"
          >
            Disconnect
          </Button>
        </div>
      </div>

      {/* Main content area with video and optional terminal */}
      <div className={`flex-1 flex flex-col overflow-hidden ${showTerminal ? 'h-full' : ''}`}>
        {/* Video container */}
        <div className={`flex items-center justify-center overflow-hidden ${showTerminal ? 'flex-1' : 'flex-1'}`}>
          {/* KeyboardHandler for enhanced keyboard capture */}
          <KeyboardHandler
            onKeyEvent={handleKeyEvent}
            enabled={status === 'connected' && !showTerminal}
            targetRef={videoRef as React.RefObject<HTMLElement>}
            onFocusChange={handleKeyboardFocusChange}
          />

          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="max-w-full max-h-full cursor-default focus:outline-none focus:ring-2 focus:ring-blue-500"
            style={{
              objectFit: 'contain',
            }}
            onMouseMove={handleMouseMove}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onWheel={handleWheel}
            tabIndex={0}
            onContextMenu={(e) => e.preventDefault()}
          />
        </div>

        {/* Terminal panel */}
        {showTerminal && terminalDataChannelRef.current && (
          <div className="h-64 border-t border-gray-700 bg-black flex flex-col">
            {/* Terminal header */}
            <div className="flex items-center justify-between px-3 py-1 bg-gray-900 border-b border-gray-700">
              <span className="text-xs font-medium text-gray-300">Terminal</span>
              <button
                onClick={handleTerminalClose}
                className="text-gray-400 hover:text-white p-0.5 rounded hover:bg-gray-700"
                title="Close terminal"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Terminal content */}
            <div className="flex-1 overflow-hidden">
              <Suspense
                fallback={
                  <div className="flex items-center justify-center h-full text-gray-400">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400 mr-2" />
                    Loading terminal...
                  </div>
                }
              >
                <RemoteTerminal
                  dataChannel={terminalDataChannelRef.current}
                  onClose={handleTerminalClose}
                  className="h-full"
                />
              </Suspense>
            </div>
          </div>
        )}

        {/* Terminal placeholder when no data channel */}
        {showTerminal && !terminalDataChannelRef.current && (
          <div className="h-64 border-t border-gray-700 bg-gray-900 flex items-center justify-center">
            <div className="text-center text-gray-400">
              <svg className="w-8 h-8 mx-auto mb-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-sm">Terminal unavailable</p>
              <p className="text-xs mt-1">Waiting for data channel connection...</p>
            </div>
          </div>
        )}
      </div>

      {/* Loading overlay */}
      {status === 'connecting' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-75">
          <div className="text-white text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-white mx-auto mb-4" />
            <p className="text-lg">Establishing connection...</p>
            <p className="text-sm text-gray-400 mt-2">Session: {sessionId}</p>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-75">
          <div className="text-white text-center">
            <div className="text-red-500 mb-4">
              <svg className="w-16 h-16 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <p className="text-lg">Connection failed</p>
            <Button
              onClick={handleDisconnectClick}
              variant="outline"
              className="mt-4"
            >
              Go Back
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default RemoteDesktopViewer;
