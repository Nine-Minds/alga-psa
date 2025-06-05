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
# Add Xvfb environment variables for better compatibility
ENV XVFB_WHD=1920x1024x16
ENV XVFB_COLORDEPTH=16
ENV XVFB_ARGS="-ac -nolisten tcp -dpi 96 +extension RANDR"
# Force software rendering to avoid DRI driver issues
ENV LIBGL_ALWAYS_SOFTWARE=1
ENV GALLIUM_DRIVER=llvmpipe
ENV LP_NO_RAST=false
ENV LIBGL_DRI3_DISABLE=1
ENV LIBGL_ALWAYS_INDIRECT=1

# Update package list and install essential dependencies
RUN apt-get update -qq && \
    apt-get install -qq -y --no-install-recommends \
      ca-certificates \
      gnupg2 \
      apt-transport-https \
      software-properties-common && \
    apt-get update -qq

# Install Chromium and dependencies (split to avoid Python package conflicts)
RUN apt-get install -qq -y --no-install-recommends \
      libgconf-2-4 \
      libxss1 \
      libxtst6 \
      libxext6 \
      libxrender1 \
      libxrandr2 \
      libxinerama1 \
      libxi6 \
      libxcursor1 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxft2 \
      chromium \
      chromium-sandbox \
      xvfb \
      x11vnc \
      fluxbox \
      x11-utils \
      xauth \
      fonts-ipafont-gothic \
      fonts-wqy-zenhei \
      curl \
      vim \
      nano \
      procps \
      python3 \
      python3-pip \
      dbus-x11 && \
    rm -rf /var/lib/apt/lists/*

# Install websockify via pip to avoid debian package issues
RUN pip3 install --no-cache-dir websockify==0.10.0

# Download NoVNC manually to avoid package dependencies
RUN mkdir -p /usr/share/novnc && \
    curl -fsSL https://github.com/novnc/noVNC/archive/v1.3.0.tar.gz | \
    tar -xz --strip-components=1 -C /usr/share/novnc

# Create and switch to non-root user
RUN useradd -m appuser

# Copy VNC helper pages and set custom index
COPY vnc-index.html /usr/share/novnc/index.html
COPY vnc-autoconnect.html /usr/share/novnc/autoconnect.html
COPY vnc-debug.html /usr/share/novnc/debug.html
COPY vnc-launcher.html /usr/share/novnc/launcher.html
COPY vnc-simple.html /usr/share/novnc/simple.html
COPY vnc-test-ws.html /usr/share/novnc/test-ws.html
COPY vnc-direct.html /usr/share/novnc/direct.html
COPY vnc-working.html /usr/share/novnc/working.html

# Make novnc directory writable by appuser
RUN chown -R appuser:appuser /usr/share/novnc
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY --chown=appuser:appuser package*.json ./
RUN npm install

# Copy application files
COPY --chown=appuser:appuser . .

# Make startup scripts executable
RUN chmod +x vnc-startup.sh || true && \
    chmod +x vnc-startup-improved.sh || true && \
    chmod +x vnc-startup-k8s-fix.sh || true && \
    chmod +x vnc-startup-websocket-fix.sh || true

USER appuser

# Expose VNC port
EXPOSE 4000 5900

# Use improved startup script for VNC or direct Xvfb for headless
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
