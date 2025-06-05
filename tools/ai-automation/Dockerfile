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
      fonts-ipafont-gothic \
      fonts-wqy-zenhei \
      curl \
      vim \
      nano \
      dbus \
      dbus-x11 \
      fluxbox \
      x11vnc \
      procps && \
    rm -rf /var/lib/apt/lists/*

# Create and switch to non-root user
RUN useradd -m appuser
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY --chown=appuser:appuser package*.json ./
RUN npm install

# Copy application files
COPY --chown=appuser:appuser . .

# Create startup script as root
RUN echo '#!/bin/bash\n\
# Start D-Bus session bus (not system bus)\n\
eval $(dbus-launch --sh-syntax)\n\
\n\
# Start Xvfb\n\
Xvfb :99 -screen 0 1920x1080x24 -ac > /dev/null 2>&1 &\n\
sleep 2\n\
\n\
# Start window manager\n\
DISPLAY=:99 fluxbox > /dev/null 2>&1 &\n\
\n\
# Optional: Start VNC server for debugging (uncomment if needed)\n\
# DISPLAY=:99 x11vnc -nopw -forever -shared -rfbport 5900 > /dev/null 2>&1 &\n\
\n\
# Start the application\n\
exec npm run dev\n\
' > /home/appuser/start.sh && chmod +x /home/appuser/start.sh && chown appuser:appuser /home/appuser/start.sh

USER appuser

# Expose ports - 4000 for API, 5900 for VNC (if enabled)
EXPOSE 4000 5900

# Start the application with display support
CMD ["/bin/bash", "/home/appuser/start.sh"]
