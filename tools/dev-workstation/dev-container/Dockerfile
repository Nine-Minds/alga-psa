## Extend the official code-server image and install Node.js LTS

# 1. Base image
FROM codercom/code-server:latest

# 2. Switch to root to install packages
USER root

# 3. Install prerequisites for NodeSource installer
RUN apt-get update \
    && apt-get install -y curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 4. Add NodeSource repository and install Node.js LTS (18.x)
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# 5. (Optional) Verify versions
RUN node -v && npm -v

RUN npm install -g @anthropic-ai/claude-code

# 6. Switch back to the 'coder' user
USER coder

# 7. Default work directory is already /home/coder/project
#    Expose any additional ports if needed

# 8. Entry point is inherited from the base image

# End of Dockerfile