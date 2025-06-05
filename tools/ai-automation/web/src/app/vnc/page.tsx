'use client';

import { useEffect, useRef } from 'react';
import Script from 'next/script';

export default function VNCViewer() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<any>(null);

  const connectVNC = () => {
    if (!window.RFB || !canvasRef.current) return;

    // Get the AI API hostname from environment or construct it
    const namespace = process.env.NEXT_PUBLIC_ALGA_BRANCH_SANITIZED || 'alga-dev-feat-bbl2';
    const vncHost = window.location.hostname;
    const vncPort = 5900; // We'll proxy this through nginx

    const url = `ws://${vncHost}:${window.location.port}/vnc`;
    
    console.log('Connecting to VNC:', url);

    rfbRef.current = new window.RFB(canvasRef.current, url, {
      credentials: { password: '' },
      scaleViewport: true,
      resizeSession: false,
    });

    rfbRef.current.addEventListener('connect', () => {
      console.log('VNC connected');
    });

    rfbRef.current.addEventListener('disconnect', (e: any) => {
      console.log('VNC disconnected:', e.detail);
    });

    rfbRef.current.addEventListener('error', (e: any) => {
      console.error('VNC error:', e.detail);
    });
  };

  return (
    <div style={{ width: '100vw', height: '100vh', backgroundColor: '#000' }}>
      <Script
        src="https://cdn.jsdelivr.net/npm/@novnc/novnc@1.4.0/core/rfb.js"
        onLoad={connectVNC}
      />
      <div 
        ref={canvasRef}
        style={{ 
          width: '100%', 
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      />
    </div>
  );
}

declare global {
  interface Window {
    RFB: any;
  }
}