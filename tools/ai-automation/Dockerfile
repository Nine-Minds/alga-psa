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

USER appuser

# Expose VNC port
EXPOSE 4000 5900

# Use a simpler approach with xvfb-run
CMD if [ "$VNC_ENABLED" = "true" ]; then \
      echo "Starting with VNC support..." && \
      xvfb-run -a -s "-screen 0 1920x1080x24" -- bash -c '\
        export DISPLAY=$DISPLAY && \
        fluxbox & \
        x11vnc -display $DISPLAY -nopw -listen localhost -xkb -forever -shared -rfbport 5901 & \
        websockify 0.0.0.0:5900 localhost:5901 & \
        npm run dev \
      '; \
    else \
      xvfb-run -a -s "-screen 0 1920x1080x24" npm run dev; \
    fi
