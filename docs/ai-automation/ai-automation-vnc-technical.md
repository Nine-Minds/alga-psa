# AI Automation VNC - Technical Implementation Guide

## Code Architecture

### File Structure

```
tools/ai-automation/
├── src/
│   ├── index.ts                    # Main application entry point
│   ├── browserSessionManager.ts    # Browser session management
│   └── puppeteerManager.ts         # Puppeteer lifecycle management
├── vnc-startup-improved.sh         # Enhanced VNC startup script
├── vnc-autoconnect.html            # Auto-connecting VNC client
├── vnc-index.html                  # VNC client index page
├── vnc-debug.html                  # VNC debugging interface
└── Dockerfile                     # Container configuration
```

## Implementation Details

### 1. Browser Mode Detection

The system automatically detects VNC mode and configures browser accordingly:

```typescript
// src/index.ts (lines 601-611)
async function startServer() {
  console.log('Initializing Puppeteer...');
  
  // Use headed mode when VNC is enabled for visual debugging
  const useHeadedMode = process.env.VNC_ENABLED === 'true';
  console.log(`VNC_ENABLED: ${process.env.VNC_ENABLED}, using headed mode: ${useHeadedMode}`);
  
  await puppeteerManager.init({
    headless: !useHeadedMode,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  }, 5);
}
```

### 2. Browser Session Management

The `BrowserSessionManager` handles both headless and headed modes:

```typescript
// src/browserSessionManager.ts (lines 39-58)
public async createSession(sessionId: string, mode: 'headless' | 'headed' = 'headless'): Promise<BrowserSession> {
  console.log(`[SESSION] Creating new ${mode} browser session: ${sessionId}`);

  const launchOptions = {
    headless: mode === 'headless',
    args: mode === 'headed' 
      ? [
          '--window-size=1900,1200',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor'
        ]
      : [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--window-size=1900,1200'
        ],
    protocolTimeout: 60000,
    dumpio: false,
    slowMo: mode === 'headed' ? 50 : 100
  };

  const browser = await puppeteer.launch(launchOptions);
  // ... rest of session creation
}
```

### 3. VNC Startup Script

The enhanced startup script (`vnc-startup-improved.sh`) provides robust VNC initialization:

#### Key Features:
- **Resource Detection**: Automatically adjusts configuration based on available memory
- **Fallback Configurations**: Multiple Xvfb configurations for compatibility
- **Error Handling**: Comprehensive error checking and recovery
- **Process Management**: Proper cleanup and restart capabilities

#### Configuration Levels:

```bash
# Memory-based configuration selection
case "$config_level" in
    "minimal")    # <256MB RAM
        configs=(
            "-screen 0 640x480x8 -ac -extension GLX"
            "-screen 0 640x480x8 -ac"
            "-screen 0 320x240x8 -ac"
        )
        ;;
    "reduced")    # 256-512MB RAM
        configs=(
            "-screen 0 1024x768x16 -ac -nolisten tcp -extension GLX"
            "-screen 0 800x600x16 -ac -extension GLX"
            "-screen 0 800x600x8 -ac"
        )
        ;;
    *)           # >512MB RAM
        configs=(
            "-screen 0 1280x1024x16 -ac -nolisten tcp -extension GLX +extension RANDR"
            "-screen 0 1024x768x16 -ac -extension GLX"
            "-screen 0 800x600x16 -ac"
            "-screen 0 640x480x8 -ac"
        )
        ;;
esac
```

### 4. Window Manager Configuration

Fluxbox is configured with an auto-generated menu:

```bash
# vnc-startup-improved.sh (lines 166-181)
mkdir -p ~/.fluxbox
if [ ! -f ~/.fluxbox/menu ]; then
    cat > ~/.fluxbox/menu << 'EOF'
[begin] (Fluxbox)
[exec] (Terminal) {x-terminal-emulator}
[exec] (File Manager) {thunar}
[submenu] (Applications)
    [exec] (Web Browser) {chromium}
    [exec] (Text Editor) {nano}
[end]
[submenu] (System)
    [exec] (Reload Config) {fluxbox-remote reload}
    [restart] (Restart)
    [exit] (Exit)
[end]
[end]
EOF
fi
```

### 5. Docker Configuration

The Dockerfile properly sets up the VNC environment:

```dockerfile
# Environment variables for VNC
ENV DISPLAY=:99
ENV XVFB_WHD=1280x1024x16
ENV XVFB_COLORDEPTH=16
ENV XVFB_ARGS="-ac -nolisten tcp -dpi 96 +extension RANDR"

# Force software rendering for Kubernetes compatibility
ENV LIBGL_ALWAYS_SOFTWARE=1
ENV GALLIUM_DRIVER=llvmpipe
ENV LP_NO_RAST=false
ENV LIBGL_DRI3_DISABLE=1
ENV LIBGL_ALWAYS_INDIRECT=1

# Install VNC components
RUN apt-get install -qq -y --no-install-recommends \
      xvfb \
      x11vnc \
      fluxbox \
      x11-utils \
      xauth \
      python3 \
      python3-pip

# Install websockify for WebSocket proxy
RUN pip3 install --no-cache-dir websockify==0.10.0

# Copy VNC client files
COPY vnc-*.html /usr/share/novnc/

# Make startup scripts executable
RUN chmod +x vnc-startup*.sh || true

# Conditional startup based on VNC_ENABLED
CMD if [ "$VNC_ENABLED" = "true" ]; then \
      if [ -f "./vnc-startup-improved.sh" ]; then \
        echo "Using improved VNC startup script..." && \
        ./vnc-startup-improved.sh npm run dev; \
      else \
        echo "Using standard VNC startup script..." && \
        ./vnc-startup.sh; \
      fi \
    else \
      export DISPLAY=:99 && \
      Xvfb :99 -screen 0 1024x768x16 -ac > /tmp/xvfb.log 2>&1 & \
      sleep 2 && \
      npm run dev; \
    fi
```

## Process Management

### Service Dependencies

The VNC system has a specific startup order:

1. **Xvfb** - Must start first to provide display
2. **Fluxbox** - Window manager depends on Xvfb
3. **x11vnc** - VNC server connects to display
4. **Websockify** - WebSocket proxy for web access
5. **Application** - Node.js app launches browser

### Process Monitoring

Each component includes health checks:

```bash
check_process() {
    local process_name=$1
    if pgrep -f "$process_name" > /dev/null; then
        local pid=$(pgrep -f "$process_name" | head -1)
        log_info "$process_name is running (PID: $pid)"
        return 0
    else
        log_error "$process_name is NOT running"
        return 1
    fi
}
```

### Error Recovery

The system includes automatic retry logic:

```bash
# x11vnc startup with retries
for attempt in $(seq 1 $MAX_RETRIES); do
    log_info "Starting x11vnc (attempt $attempt/$MAX_RETRIES)..."
    
    x11vnc -display :${DISPLAY_NUM} \
           -nopw \
           -listen localhost \
           -xkb \
           -ncache 10 \
           -ncache_cr \
           -forever \
           -shared \
           -rfbport ${VNC_PORT} \
           -o /tmp/xvfb/x11vnc.log \
           > /tmp/xvfb/x11vnc_stdout.log 2>&1 &
    
    sleep 3
    
    if check_process "x11vnc"; then
        vnc_started=true
        break
    else
        log_warn "x11vnc failed to start, attempt $attempt"
        sleep $RETRY_DELAY
    fi
done
```

## Network Configuration

### Port Mapping

| Service | Internal Port | External Port | Protocol |
|---------|---------------|---------------|----------|
| x11vnc | 5901 | - | VNC |
| websockify | 5900 | 5900 | WebSocket |
| Node.js API | 4000 | 4000 | HTTP |

### Nginx Proxy Configuration

For production deployments, nginx routes VNC traffic:

```nginx
server {
    listen 8080;
    server_name _;

    # VNC WebSocket proxy
    location /vnc/ {
        proxy_pass http://127.0.0.1:5900/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }

    # API endpoints
    location /api/ {
        proxy_pass http://127.0.0.1:4000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Default to web interface
    location / {
        proxy_pass http://127.0.0.1:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Memory Management

### Resource Optimization

The system optimizes resource usage based on available memory:

```bash
check_system_resources() {
    log_info "Checking system resources..."
    
    # Memory check
    local mem_available=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
    log_info "Available memory: ${mem_available}MB"
    
    if [ "$mem_available" -lt 256 ]; then
        echo "minimal"
    elif [ "$mem_available" -lt 512 ]; then
        echo "reduced"
    else
        echo "standard"
    fi
}
```

### X Server Configuration

Software rendering is forced to avoid driver issues:

```bash
# Force software rendering for compatibility
export LIBGL_ALWAYS_SOFTWARE=1
export GALLIUM_DRIVER=llvmpipe
export LP_NO_RAST=false
export LIBGL_DRI3_DISABLE=1
export LIBGL_ALWAYS_INDIRECT=1
```

## Debugging and Monitoring

### Log Files

All components write to structured log files:

```bash
/tmp/xvfb/
├── xvfb.log              # Xvfb output
├── xdpyinfo.log          # Display test results
├── fluxbox.log           # Window manager logs
├── x11vnc.log            # VNC server logs
└── x11vnc_stdout.log     # VNC server stdout
```

### Health Check Endpoints

The application provides health check endpoints:

```typescript
app.get('/api/browser/status', async (req, res) => {
  try {
    const page = puppeteerManager.getPage();
    const url = page.url();
    res.json({ 
      status: 'ok', 
      url: url,
      vnc_enabled: process.env.VNC_ENABLED === 'true'
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'error', 
      message: error.message 
    });
  }
});
```

### Performance Metrics

Monitor key metrics for performance:

- **Memory usage**: Container memory consumption
- **CPU usage**: X server and browser CPU usage  
- **Network**: VNC traffic and WebSocket connections
- **Response time**: Browser automation response times

## Security Implementation

### Sandboxing

Browser security is maintained through sandboxing:

```typescript
args: [
  '--no-sandbox',           // Required for containers
  '--disable-setuid-sandbox', // Required for non-root
  '--disable-web-security', // For headed mode flexibility
  '--disable-features=VizDisplayCompositor' // Performance optimization
]
```

### Network Isolation

VNC access is restricted:
- x11vnc binds to localhost only
- websockify provides controlled WebSocket access
- No direct VNC protocol exposure outside container

### User Permissions

Container runs as non-root user:

```dockerfile
RUN useradd -m appuser
USER appuser
```

## Testing and Validation

### Automated Tests

Health checks verify VNC functionality:

```bash
# Test X display
DISPLAY=:99 xdpyinfo > /dev/null 2>&1

# Test window manager
pgrep fluxbox > /dev/null

# Test VNC server
netstat -ln | grep 5901 > /dev/null

# Test WebSocket proxy
netstat -ln | grep 5900 > /dev/null
```

### Manual Testing

Validation checklist:
1. Container starts without errors
2. All VNC processes are running
3. VNC client can connect
4. Browser window is visible
5. Automation tasks work in headed mode
6. No memory leaks during extended operation

## Performance Tuning

### VNC Optimization

x11vnc is configured for optimal performance:

```bash
x11vnc -display :${DISPLAY_NUM} \
       -nopw \                    # No password for speed
       -listen localhost \        # Local only for security
       -xkb \                     # Keyboard support
       -ncache 10 \               # Client-side caching
       -ncache_cr \               # Cache collision reduction
       -forever \                 # Keep running
       -shared \                  # Multiple clients
       -rfbport ${VNC_PORT}
```

### Browser Performance

Puppeteer is optimized for VNC:

```typescript
slowMo: mode === 'headed' ? 50 : 100  // Slower for visual debugging
```

### Resource Limits

Recommended Kubernetes resource limits:

```yaml
resources:
  requests:
    memory: "512Mi"
    cpu: "250m"
  limits:
    memory: "2Gi"
    cpu: "1"
```

This documentation provides complete technical details for implementing, maintaining, and troubleshooting the VNC system in the AI automation platform.