FROM node:18-bullseye

# Environment variables
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROME_PATH=/usr/bin/chromium
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_OPTIONS="--max-http-header-size=26214400"
ENV CHOKIDAR_USEPOLLING=true
ENV CHOKIDAR_INTERVAL=300

# Install dependencies
RUN apt-get update && \
    apt-get install -y \
      chromium \
      chromium-sandbox \
      xvfb \
      dbus-x11 \
      fonts-ipafont-gothic \
      fonts-wqy-zenhei \
      fonts-liberation \
      libappindicator3-1 \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libcups2 \
      libdrm2 \
      libgbm1 \
      libgconf-2-4 \
      libgtk-3-0 \
      libnspr4 \
      libnss3 \
      libx11-xcb1 \
      libxcomposite1 \
      libxcursor1 \
      libxdamage1 \
      libxfixes3 \
      libxi6 \
      libxrandr2 \
      libxss1 \
      libxtst6 \
      xdg-utils \
      --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Create user
RUN useradd -m appuser
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY --chown=appuser:appuser package*.json ./
RUN npm install

# Copy application files
COPY --chown=appuser:appuser . .

# Create run script
RUN echo '#!/bin/bash\n\
# Create necessary directories\n\
mkdir -p /tmp/.X11-unix\n\
chmod 1777 /tmp/.X11-unix\n\
\n\
# Start Xvfb with proper configuration\n\
Xvfb :99 -screen 0 1920x1080x24 -ac -nolisten tcp -nolisten unix &\n\
export DISPLAY=:99\n\
\n\
# Wait for X server to be ready\n\
sleep 3\n\
\n\
# Start D-Bus\n\
if [ -z "$DBUS_SESSION_BUS_ADDRESS" ]; then\n\
  eval $(dbus-launch --sh-syntax)\n\
fi\n\
\n\
# For headed mode, Chrome will use the virtual display\n\
echo "Display configured: $DISPLAY"\n\
echo "D-Bus address: $DBUS_SESSION_BUS_ADDRESS"\n\
\n\
# Run the application\n\
exec npm run dev\n\
' > /home/appuser/entrypoint.sh && \
chmod +x /home/appuser/entrypoint.sh && \
chown appuser:appuser /home/appuser/entrypoint.sh

USER appuser

EXPOSE 4000

ENTRYPOINT ["/home/appuser/entrypoint.sh"]