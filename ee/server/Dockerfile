FROM node:22.5.1

# Install necessary OS packages in a single layer
RUN apt-get update && apt-get install -y \
    graphicsmagick \
    imagemagick \
    ghostscript \
    postgresql-client \
    redis-tools \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only package.json to leverage caching in npm install
COPY ./package.json ./package.json 
RUN npm install


# Copy source code files that are less likely to change the dependency tree
RUN mkdir -p /app/ee/server/src/app 
COPY ./server /app/server 
COPY ./ee/server/setup /app/server/setup 
COPY ./ee/server/src /app/ee/server/src 
COPY ./ee/server/run-migrations.cjs /app/ee/server/run-migrations.cjs 
COPY ./ee/server/run-seeds.cjs /app/ee/server/run-seeds.cjs 
COPY ./ee/server/knexfile.cjs /app/ee/server/knexfile.cjs

# Create migration directories
RUN mkdir -p ./app/migrations /app/server/migrations

# Copy migrations directories if they exist (using COPY's built-in error handling)
COPY ./server/migrations/ /app/migrations/
COPY ./server/migrations/ /app/server/migrations/
COPY ./ee/server/migrations/ /app/migrations/
COPY ./ee/server/migrations/ /app/server/migrations/

# Create seeds directory and copy seed files
RUN mkdir -p /app/seeds/dev && cp -r ./server/seeds/dev/* /app/seeds/dev/

# Clean up any existing environment files
RUN rm -rf /app/.env /app/server/.env

# Copy entrypoint script and make it executable
COPY ./server/entrypoint.sh /app/entrypoint.sh 
RUN chmod +x /app/entrypoint.sh

# Expose port 3000 and set NODE_ENV to production
EXPOSE 3000 
ENV NODE_ENV=production

CMD ["/app/entrypoint.sh"]