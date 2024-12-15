FROM node:22.5.1

# Install required system dependencies
RUN apt-get update && apt-get install -y \
    graphicsmagick \
    imagemagick \
    ghostscript \
    postgresql-client \
    redis-tools \
    curl \
    && rm -rf /var/lib/apt/lists/*

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

# Remove any existing .env file to prevent conflicts
RUN rm -f ./.env

# Make port 3000 available to the world outside this container
EXPOSE 3000

# Define environment variable
ENV NODE_ENV=production

# Set the entrypoint script
ENTRYPOINT ["./entrypoint.sh"]
