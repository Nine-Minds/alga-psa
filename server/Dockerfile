FROM node:20.9-alpine AS server

# Install required system dependencies
RUN apk add --no-cache \
    graphicsmagick \
    imagemagick \
    ghostscript \
    postgresql-client \
    redis \
    curl \
    bash

WORKDIR /app/server

# Copy root package.json first (will be copied from the build context)
COPY package.json package-lock.json /app/

# Copy server package.json
COPY server/package.json server/package-lock.json ./

# Install dependencies from root package.json
WORKDIR /app
RUN npm install

# Go back to server directory
WORKDIR /app/server

# Copy the server directory contents
COPY server/ ./

# Copy entrypoint script
COPY server/entrypoint.sh /app/entrypoint.sh

# Make entrypoint script executable
RUN chmod +x /app/entrypoint.sh

# Make port 3000 available to the world outside this container
EXPOSE 3000

# Define environment variable
ENV NODE_ENV=production

# Set the entrypoint script
ENTRYPOINT ["/app/entrypoint.sh"]
