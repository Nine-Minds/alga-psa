FROM node:18-bullseye-slim

# Environment variables
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROME_PATH=/usr/bin/chromium
ENV DEBIAN_FRONTEND=noninteractive
ENV DISPLAY=:99
ENV NODE_OPTIONS="--max-http-header-size=26214400"
ENV CHOKIDAR_USEPOLLING=true
ENV CHOKIDAR_INTERVAL=300

# Update package list and install essential dependencies
RUN apt-get update -qq && \
    apt-get install -qq -y --no-install-recommends \
      ca-certificates \
      gnupg2 \
      apt-transport-https \
      software-properties-common && \
    apt-get update -qq

# Install Chromium and dependencies
RUN apt-get install -qq -y --no-install-recommends \
      libgconf-2-4 \
      libxss1 \
      libxtst6 \
      chromium \
      chromium-sandbox \
      xvfb \
      x11vnc \
      fluxbox \
      x11-utils \
      websockify \
      fonts-ipafont-gothic \
      fonts-wqy-zenhei \
      curl \
      vim \
      nano \
      procps \
      python3 && \
    rm -rf /var/lib/apt/lists/*

# Create and switch to non-root user
RUN useradd -m appuser
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY --chown=appuser:appuser package*.json ./
RUN npm install

# Copy application files
COPY --chown=appuser:appuser . .

# Create startup script
RUN echo '#!/bin/bash\n\
# Start Xvfb\n\
Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset > /dev/null 2>&1 &\n\
export DISPLAY=:99\n\
\n\
# Wait for X server to be ready\n\
echo "Waiting for X server to start..."\n\
for i in {1..30}; do\n\
  if xdpyinfo -display :99 >/dev/null 2>&1; then\n\
    echo "X server is ready"\n\
    break\n\
  fi\n\
  echo "Waiting for X server... ($i/30)"\n\
  sleep 1\n\
done\n\
\n\
# Start window manager\n\
fluxbox > /dev/null 2>&1 &\n\
\n\
# Start VNC server if VNC_ENABLED is set\n\
if [ "$VNC_ENABLED" = "true" ]; then\n\
  echo "Starting VNC server..."\n\
  # Start VNC server on port 5901 (traditional VNC port)\n\
  x11vnc -display :99 -nopw -listen localhost -xkb -ncache 10 -ncache_cr -forever -shared -rfbport 5901 &\n\
  sleep 2\n\
  \n\
  # Start websockify to proxy WebSocket to VNC\n\
  echo "Starting WebSocket proxy on port 5900..."\n\
  websockify --web=/usr/share/novnc 0.0.0.0:5900 localhost:5901 &\n\
  echo "VNC server started successfully"\n\
fi\n\
\n\
# Start the application\n\
exec npm run dev\n\
' > /home/appuser/start.sh && chmod +x /home/appuser/start.sh && chown appuser:appuser /home/appuser/start.sh

USER appuser

# Expose VNC port
EXPOSE 4000 5900

# Start the app
CMD ["/bin/bash", "/home/appuser/start.sh"]
