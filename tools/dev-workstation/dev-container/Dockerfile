## Extend the official code-server image and install Node.js LTS

# 1. Base image
FROM codercom/code-server:latest

# 2. Switch to root to install packages
USER root

# 3. Install prerequisites
RUN apt-get update \
    && apt-get install -y curl ca-certificates gnupg \
    && mkdir -p /etc/apt/keyrings

# 4. Set up Node.js 22.x repository
RUN curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list

# 5. Install Node.js 22.x
RUN apt-get update \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# 6. Verify installed versions
RUN node -v && npm -v

# 7. Install global packages
RUN npm install -g @anthropic-ai/claude-code

# 8. Switch back to the 'coder' user
USER coder

# 7. Default work directory is already /home/coder/project
#    Expose any additional ports if needed

# 8. Entry point is inherited from the base image

# End of Dockerfile