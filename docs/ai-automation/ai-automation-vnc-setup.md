# AI Automation VNC Setup Guide

## Overview

The AI automation system supports VNC (Virtual Network Computing) for visual debugging and monitoring of browser automation tasks. This allows developers to see the browser in real-time as Puppeteer performs automation tasks.

## Architecture

The VNC system consists of several components working together:

```
┌─────────────────┐    ┌──────────────┐    ┌─────────────┐
│   Web Browser   │───▶│ NoVNC Client │───▶│ WebSocket   │
│  (User Client)  │    │ (JavaScript) │    │ Proxy       │
└─────────────────┘    └──────────────┘    └─────────────┘
                                                   │
                                                   ▼
┌─────────────────┐    ┌──────────────┐    ┌─────────────┐
│    Chromium     │◀───│   Fluxbox    │◀───│   x11vnc    │
│   (Puppeteer)   │    │ Window Mgr   │    │ VNC Server  │
└─────────────────┘    └──────────────┘    └─────────────┘
                                                   ▲
                                                   │
                              ┌─────────────────────┴─────────────────────┐
                              │              Xvfb                         │
                              │         (Virtual X Server)                │
                              │         Display :99                       │
                              └───────────────────────────────────────────┘
```

## Components

### 1. Xvfb (X Virtual Framebuffer)
- **Purpose**: Provides a virtual X11 display server
- **Display**: `:99` (configurable)
- **Resolution**: 1280x1024x16 (optimized for performance)
- **Configuration**: Hardware acceleration disabled for Kubernetes compatibility

### 2. Fluxbox (Window Manager)
- **Purpose**: Manages windows and provides desktop environment
- **Features**: Lightweight, minimal resource usage
- **Menu**: Right-click context menu with applications
- **Config**: Automatically generates basic menu on startup

### 3. x11vnc (VNC Server)
- **Purpose**: Shares the X display over VNC protocol
- **Port**: 5901 (internal)
- **Security**: No password (localhost only)
- **Features**: Caching enabled for better performance

### 4. Websockify (WebSocket Proxy)
- **Purpose**: Bridges VNC protocol to WebSocket for web browsers
- **Port**: 5900 (exposed)
- **Client**: NoVNC JavaScript client

### 5. NoVNC (Web VNC Client)
- **Purpose**: HTML5 VNC client for browsers
- **Access**: Available at `/vnc/` endpoint
- **Features**: Auto-connect, scaling, touch support

## Environment Configuration

### Required Environment Variables

| Variable | Value | Purpose |
|----------|-------|---------|
| `VNC_ENABLED` | `true` | Enables VNC mode in container |
| `DISPLAY` | `:99` | X11 display number |

### Docker Configuration

The Dockerfile includes all necessary VNC components:

```dockerfile
# Install VNC components
RUN apt-get install -qq -y --no-install-recommends \
      xvfb \
      x11vnc \
      fluxbox \
      x11-utils \
      xauth \
      python3 \
      python3-pip

# Install websockify
RUN pip3 install --no-cache-dir websockify==0.10.0

# Copy NoVNC client
RUN mkdir -p /usr/share/novnc && \
    curl -fsSL https://github.com/novnc/noVNC/archive/v1.3.0.tar.gz | \
    tar -xz --strip-components=1 -C /usr/share/novnc
```

## Startup Process

### 1. Container Initialization

When `VNC_ENABLED=true`, the container uses the improved VNC startup script:

```bash
./vnc-startup-improved.sh npm run dev
```

### 2. Service Startup Sequence

1. **Directory Setup**: Creates required directories with proper permissions
2. **Xvfb Launch**: Starts virtual X server with fallback configurations
3. **Window Manager**: Launches Fluxbox with auto-generated menu
4. **VNC Server**: Starts x11vnc with optimized settings
5. **WebSocket Proxy**: Launches websockify for web access
6. **Application**: Starts the Node.js AI automation server

### 3. Browser Mode Detection

The application automatically detects VNC mode and configures Puppeteer accordingly:

```typescript
// In src/index.ts
const useHeadedMode = process.env.VNC_ENABLED === 'true';
await puppeteerManager.init({
  headless: !useHeadedMode,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});
```

## Access Methods

### 1. Direct VNC Access

Connect using any VNC client to `<pod-ip>:5900` or through port forwarding:

```bash
kubectl port-forward pod/<pod-name> 5900:5900 -n <namespace>
```

### 2. Web Browser Access

Access through the web interface at:
- Auto-connect: `http://<host>:5900/autoconnect.html`
- Manual connect: `http://<host>:5900/vnc.html`
- Debug interface: `http://<host>:5900/debug.html`

### 3. Kubernetes Port Forwarding

For development access:

```bash
# Forward VNC port
kubectl port-forward deployment/<deployment-name> 5900:5900 -n <namespace>

# Forward API port (if needed)
kubectl port-forward deployment/<deployment-name> 4000:4000 -n <namespace>
```

## Troubleshooting

### Common Issues

#### 1. Black Screen
**Symptoms**: VNC connects but shows only black screen
**Causes**: 
- Xvfb not running
- Window manager crashed
- No applications visible

**Solutions**:
```bash
# Check processes
kubectl exec <pod> -- ps aux | grep -E "(Xvfb|fluxbox|x11vnc)"

# Restart window manager
kubectl exec <pod> -- pkill fluxbox
kubectl exec <pod> -- DISPLAY=:99 fluxbox &

# Check logs
kubectl exec <pod> -- cat /tmp/xvfb/fluxbox.log
```

#### 2. VNC Connection Refused
**Symptoms**: Cannot connect to VNC port
**Causes**:
- x11vnc not running
- Port not exposed
- Firewall blocking connection

**Solutions**:
```bash
# Check x11vnc process
kubectl exec <pod> -- pgrep x11vnc

# Check port binding
kubectl exec <pod> -- netstat -ln | grep 5900

# Restart x11vnc
kubectl exec <pod> -- pkill x11vnc
kubectl exec <pod> -- x11vnc -display :99 -nopw -listen localhost -rfbport 5901 &
```

#### 3. Browser Still Headless
**Symptoms**: VNC works but browser not visible
**Causes**:
- Application not detecting VNC mode
- Browser launched before X server ready

**Solutions**:
```bash
# Check environment
kubectl exec <pod> -- env | grep VNC_ENABLED

# Check browser processes
kubectl exec <pod> -- ps aux | grep chromium

# Restart application
kubectl delete pod <pod-name>
```

### Log Locations

| Component | Log Location |
|-----------|--------------|
| Xvfb | `/tmp/xvfb/xvfb.log` |
| Fluxbox | `/tmp/xvfb/fluxbox.log` |
| x11vnc | `/tmp/xvfb/x11vnc.log` |
| Websockify | Container stdout |
| Application | Container stdout |

### Diagnostic Commands

```bash
# Check all VNC processes
kubectl exec <pod> -- ps aux | grep -E "(Xvfb|fluxbox|x11vnc|websockify)"

# Test X display
kubectl exec <pod> -- DISPLAY=:99 xdpyinfo

# Check window list
kubectl exec <pod> -- DISPLAY=:99 xwininfo -root -tree

# Monitor VNC connections
kubectl exec <pod> -- tail -f /tmp/xvfb/x11vnc.log
```

## Performance Optimization

### Resource Configuration

For optimal performance in Kubernetes:

```yaml
resources:
  requests:
    memory: "512Mi"
    cpu: "250m"
  limits:
    memory: "2Gi"
    cpu: "1"
```

### Display Settings

The startup script automatically adjusts display settings based on available memory:
- **High memory** (>512MB): 1280x1024x16
- **Medium memory** (256-512MB): 1024x768x16  
- **Low memory** (<256MB): 640x480x8

### VNC Optimization

- **Caching**: Enabled with `-ncache 10 -ncache_cr`
- **Compression**: WebSocket compression enabled
- **Color depth**: 16-bit for balance of quality and performance

## Security Considerations

### Network Security
- VNC server bound to localhost only
- No VNC password (relies on network isolation)
- WebSocket proxy provides controlled access

### Kubernetes Security
- No privileged containers required
- Runs as non-root user (`appuser`)
- No host network access needed

### Access Control
- VNC access controlled by Kubernetes network policies
- API access controlled by service exposure
- No sensitive data displayed in VNC session

## Development Workflow

### Local Development

1. **Build image with VNC**:
   ```bash
   nu cli/main.nu build-ai-api --push --use-latest
   ```

2. **Deploy with VNC enabled**:
   ```bash
   helm upgrade --install <release> ./helm \
     --set ai.api.env.VNC_ENABLED=true
   ```

3. **Access VNC**:
   ```bash
   kubectl port-forward deployment/<deployment> 5900:5900
   # Open browser to http://localhost:5900/autoconnect.html
   ```

### Debugging Browser Automation

1. **Connect to VNC** to see live browser session
2. **Use developer tools** in the automation browser
3. **Monitor console logs** in real-time
4. **Step through automation** visually

### Testing Changes

1. **Make code changes**
2. **Rebuild and redeploy** with VNC enabled
3. **Connect via VNC** to see changes in action
4. **Debug issues** visually

## Integration with Nginx Proxy

The AI automation system includes nginx as a reverse proxy for VNC access:

```nginx
# VNC WebSocket proxy
location /vnc/ {
    proxy_pass http://ai-api:5900/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# VNC static files
location /vnc/websockify {
    proxy_pass http://ai-api:5900/websockify;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

This allows accessing VNC through the main application URL at `/vnc/` path.

## Future Enhancements

### Planned Features
- **Multi-user support**: Multiple VNC sessions
- **Recording**: Session recording for debugging
- **Shared sessions**: Collaborative debugging
- **Mobile optimization**: Better touch interface

### Performance Improvements
- **GPU acceleration**: When available in Kubernetes
- **Adaptive quality**: Dynamic compression based on bandwidth
- **Connection pooling**: Reuse VNC connections

---

## Quick Start Checklist

- [ ] Set `VNC_ENABLED=true` in deployment
- [ ] Ensure VNC port (5900) is exposed
- [ ] Build image with latest VNC scripts
- [ ] Deploy to Kubernetes
- [ ] Port forward: `kubectl port-forward <pod> 5900:5900`
- [ ] Open browser to `http://localhost:5900/autoconnect.html`
- [ ] Verify browser appears in VNC session
- [ ] Test automation tasks visually

For additional support, check the troubleshooting section or container logs.