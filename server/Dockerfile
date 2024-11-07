# Use an official Node.js runtime as a parent image
FROM node:22.5.1

RUN apt-get update && apt-get install -y \
    graphicsmagick \
    imagemagick \
    ghostscript \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory to /app
WORKDIR /app

# Copy root package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

RUN rm -f /app/.env

# Make port 3000 available to the world outside this container
EXPOSE 3000

# Define environment variable
ENV NODE_ENV=production
