# Use an official Node.js runtime as a parent image
FROM node:22.5.1

RUN apt-get update && apt-get install -y \
    graphicsmagick \
    imagemagick \
    ghostscript \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory to /app
WORKDIR /app

# Copy the current directory contents into the container at /app
COPY ./server /app/server
COPY ./ee/server/setup /app/server/setup
COPY ./ee/server/src /app/src
COPY ./package.json /app
COPY ./ee/setup/config.ini /app/config.ini
COPY ./ee/server/knexfile.cjs /app/knexfile.cjs
COPY ./server/entrypoint.sh /app/entrypoint.sh

# Create migrations directory and copy both CE and EE migrations
RUN mkdir -p /app/migrations
COPY ./server/migrations/* /app/migrations/
COPY ./ee/server/migrations/* /app/migrations/

# Create seeds directory and copy seeds
RUN mkdir -p /app/seeds/dev
COPY ./server/seeds/dev/* /app/seeds/dev/

RUN rm -rf /app/.env

# Install any needed packages specified in package.json
RUN npm install

# Make port 3000 available to the world outside this container
EXPOSE 3000

# Define environment variable
ENV NODE_ENV=production

# Make entrypoint.sh executable
RUN chmod +x /app/entrypoint.sh
