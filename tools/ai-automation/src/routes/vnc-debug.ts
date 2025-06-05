import express, { Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const router = express.Router();
const execAsync = promisify(exec);

// VNC debugging endpoint
router.get('/status', async (req: Request, res: Response) => {
  try {
    const status: any = {
      timestamp: new Date().toISOString(),
      environment: {
        DISPLAY: process.env.DISPLAY,
        VNC_ENABLED: process.env.VNC_ENABLED,
        VNC_PORT: process.env.VNC_PORT || '5901',
        WEBSOCKET_PORT: process.env.WEBSOCKET_PORT || '5900'
      },
      processes: {},
      logs: {}
    };

    // Check running processes
    try {
      const { stdout: psOutput } = await execAsync('ps aux | grep -E "(Xvfb|x11vnc|websockify|fluxbox)" | grep -v grep');
      status.processes = {
        running: psOutput.trim().split('\n').filter(line => line.length > 0)
      };
    } catch (e) {
      status.processes.error = 'No VNC processes found';
    }

    // Check port bindings
    try {
      const { stdout: netstatOutput } = await execAsync('netstat -tlnp 2>/dev/null | grep -E "(5900|5901)" || ss -tlnp | grep -E "(5900|5901)"');
      status.ports = netstatOutput.trim().split('\n').filter(line => line.length > 0);
    } catch (e) {
      status.ports = 'Unable to check ports (may need elevated permissions)';
    }

    // Read log files
    const logFiles = [
      '/tmp/xvfb/websockify.log',
      '/tmp/xvfb/x11vnc.log',
      '/tmp/xvfb/xvfb.log',
      '/tmp/xvfb/fluxbox.log'
    ];

    for (const logFile of logFiles) {
      try {
        const content = await fs.readFile(logFile, 'utf-8');
        const lines = content.trim().split('\n');
        status.logs[path.basename(logFile)] = {
          lastLines: lines.slice(-20),
          size: content.length
        };
      } catch (e) {
        status.logs[path.basename(logFile)] = 'File not found or not readable';
      }
    }

    // Test websocket connection
    try {
      const { stdout: wsTest } = await execAsync('timeout 2 bash -c "echo test | nc -w 1 localhost 5900" 2>&1 || echo "Connection test failed"');
      status.websocketTest = wsTest.trim();
    } catch (e) {
      status.websocketTest = 'Connection test failed';
    }

    res.json(status);
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get VNC status',
      message: error.message
    });
  }
});

// Restart VNC services
router.post('/restart', async (req: Request, res: Response) => {
  try {
    // Kill existing processes
    await execAsync('pkill -f websockify || true');
    await execAsync('pkill -f x11vnc || true');
    
    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Restart VNC services
    const script = `
      export DISPLAY=:99
      x11vnc -display :99 -nopw -listen localhost -xkb -ncache 10 -ncache_cr -forever -shared -rfbport 5901 > /tmp/xvfb/x11vnc.log 2>&1 &
      sleep 2
      cd /usr/share/novnc && python3 -m websockify -v --web . 0.0.0.0:5900 localhost:5901 > /tmp/xvfb/websockify.log 2>&1 &
    `;
    
    await execAsync(script);
    
    res.json({
      status: 'VNC services restarted',
      message: 'Check /api/vnc/status for current state'
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to restart VNC',
      message: error.message
    });
  }
});

export default router;