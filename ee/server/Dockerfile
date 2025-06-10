FROM node:alpine


# Install necessary OS packages in a single layer
RUN apk add --no-cache \
    bash \
    postgresql-client \
    redis \
    graphicsmagick \
    imagemagick \
    ghostscript \
    curl \
    nano
WORKDIR /app

# Copy package files for dependency installation
COPY ./package.json ./package.json 
COPY ./server/package.json ./server/package.json
COPY ./tsconfig.base.json ./tsconfig.base.json
RUN npm install --omit=dev

ARG CACHE_BUST=2
# Copy pre-built shared workspace
COPY ./shared/dist ./shared/dist
COPY ./shared/package.json ./shared/package.json

# Copy source code files
RUN mkdir -p /app/ee/server/src/app 
COPY ./server /app/server 
COPY ./ee/server/setup /app/server/setup 
COPY ./ee/server/src /app/ee/server/src

# Copy pre-built Next.js application (built locally) - explicit copy to override .dockerignore
# Add cache busting argument

COPY ./server/.next /app/server/.next
COPY ./server/dist /app/server/dist 

# Copy base migrations first, then EE migrations (EE migrations will be mixed with CE ones)
COPY ./server/migrations/ /app/server/migrations/
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