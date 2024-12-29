"use client";
import React, { useEffect, useState } from 'react';
import io from 'socket.io-client';
import Image from 'next/image';

export default function ControlPanel() {
  const [imgSrc, setImgSrc] = useState('');
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    const socket = io('http://localhost:4000'); // Adjust if needed
    socket.on('connect', () => console.log('WS connected'));
    socket.on('screenshot', (data: string) => {
      setImgSrc(`data:image/png;base64,${data}`);
    });
    socket.on('disconnect', () => console.log('WS disconnected'));
    return () => { socket.disconnect(); };
  }, []);

  // Example function to run a script
  const runScript = async () => {
    const code = `document.body.style.backgroundColor = 'red';`;
    const res = await fetch('/server/api/script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const data = await res.json();
    setLog([...log, JSON.stringify(data)]);
  };

  return (
    <main style={{ padding: 20 }}>
      <h1>AI Automation Control Panel</h1>
      <div style={{ display: 'flex', gap: 20 }}>
        <div style={{ flex: 1 }}>
          <h3>Live Browser Feed</h3>
          {imgSrc ? (
            <Image
              src={imgSrc}
              alt="Feed"
              width={800}
              height={600}
              style={{ maxWidth: '100%', height: 'auto' }}
            />
          ) : (
            <p>No feed yet</p>
          )}
          <button onClick={runScript}>Change BG Color</button>
          <div>
            <h4>Logs</h4>
            {log.map((entry, i) => (
              <div key={i}>{entry}</div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
