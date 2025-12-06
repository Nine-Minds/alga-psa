'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { InputEvent } from '@/types/remoteDesktop';

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

    // Handle incoming data channel (for input events)
    peerConnectionRef.current.ondatachannel = (event) => {
      console.log('Received data channel:', event.channel.label);
      if (event.channel.label === 'input') {
        dataChannelRef.current = event.channel;
        setupDataChannel(event.channel);
      }
    };

    // Create data channel for input events (as offerer)
    const inputChannel = peerConnectionRef.current.createDataChannel('input', {
      ordered: true,
    });
    dataChannelRef.current = inputChannel;
    setupDataChannel(inputChannel);
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

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLVideoElement>) => {
    if (status !== 'connected') return;
    e.preventDefault();
    const button = e.button === 0 ? 'left' : e.button === 2 ? 'right' : 'middle';
    sendInputEvent({ type: 'MouseDown', button });
  }, [status, sendInputEvent]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLVideoElement>) => {
    if (status !== 'connected') return;
    const button = e.button === 0 ? 'left' : e.button === 2 ? 'right' : 'middle';
    sendInputEvent({ type: 'MouseUp', button });
  }, [status, sendInputEvent]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLVideoElement>) => {
    if (status !== 'connected') return;
    e.preventDefault();
    sendInputEvent({
      type: 'MouseScroll',
      delta_x: Math.round(e.deltaX),
      delta_y: Math.round(e.deltaY),
    });
  }, [status, sendInputEvent]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (status !== 'connected') return;
    e.preventDefault();
    sendInputEvent({ type: 'KeyDown', key: e.key });
  }, [status, sendInputEvent]);

  const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
    if (status !== 'connected') return;
    e.preventDefault();
    sendInputEvent({ type: 'KeyUp', key: e.key });
  }, [status, sendInputEvent]);

  const cleanup = () => {
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
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
        </div>

        <div className="flex items-center gap-2">
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

      {/* Video container */}
      <div className="flex-1 flex items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="max-w-full max-h-full cursor-default focus:outline-none"
          style={{
            objectFit: 'contain',
          }}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          tabIndex={0}
          onContextMenu={(e) => e.preventDefault()}
        />
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
