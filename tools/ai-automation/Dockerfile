FROM node:18-bullseye-slim

# Environment variables
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROME_PATH=/usr/bin/chromium
ENV DEBIAN_FRONTEND=noninteractive
ENV DISPLAY=:99
ENV NODE_OPTIONS="--max-http-header-size=26214400"

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
      curl && \
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

# Start Xvfb and run the app
CMD Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 & \
    npm run dev
