## Extend the official code-server image and install Node.js LTS

# 1. Base image
FROM codercom/code-server:latest

# 2. Switch to root to install packages
USER root

# 3. Install prerequisites for NodeSource installer
RUN apt-get update \
    && apt-get install -y curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Download and install nvm:
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
# in lieu of restarting the shell
RUN \. "$HOME/.nvm/nvm.sh"
# Download and install Node.js:
RUN nvm install 22
# Verify the Node.js version:
RUN node -v # Should print "v22.15.1".
RUN nvm current # Should print "v22.15.1".
# Verify npm version:
RUN npm -v # Should print "10.9.2".

RUN npm install -g @anthropic-ai/claude-code

# 6. Switch back to the 'coder' user
USER coder

# 7. Default work directory is already /home/coder/project
#    Expose any additional ports if needed

# 8. Entry point is inherited from the base image

# End of Dockerfile