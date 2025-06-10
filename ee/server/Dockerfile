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

# Copy only package.json to leverage caching in npm install
COPY ./package.json ./package.json 
RUN npm install


# Copy source code files that are less likely to change the dependency tree
RUN mkdir -p /app/ee/server/src/app 
COPY ./server /app/server 
COPY ./ee/server/setup /app/server/setup 
COPY ./ee/server/src /app/ee/server/src 

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