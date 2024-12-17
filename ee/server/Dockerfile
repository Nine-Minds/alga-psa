# Use an official Node.js runtime as a parent image
FROM node:22.5.1

RUN apt-get update && apt-get install -y \
    graphicsmagick \
    imagemagick \
    ghostscript \
    postgresql-client \
    redis-tools \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory to /app and create ee directory
WORKDIR /app
RUN mkdir -p /app/ee

# Copy the current directory contents into the container at /app
COPY ./server /app/server
COPY ./ee/server/setup /app/server/setup
RUN mkdir -p /app/ee/server/src/app
COPY ./ee/server/src /app/ee/server/src
COPY ./package.json /app
COPY ./server/entrypoint.sh /app/entrypoint.sh
COPY ./ee/server/run-migrations.cjs /app/ee/server/run-migrations.cjs
COPY ./ee/server/run-seeds.cjs /app/ee/server/run-seeds.cjs
COPY ./ee/server/knexfile.cjs /app/ee/server/knexfile.cjs

# Create migrations directory and copy both CE and EE migrations
RUN mkdir -p /app/migrations
COPY ./server/migrations/* /app/migrations/
COPY ./ee/server/migrations/* /app/migrations/
COPY ./server/migrations/* /app/server/migrations/
COPY ./ee/server/migrations/* /app/server/migrations/

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
