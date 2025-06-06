# Alga PSA Development Environment - Code Server

This directory contains the Docker configuration for the Alga PSA code-server development environment.

## Overview

The code-server image provides a full-featured VS Code environment running in the browser, pre-configured for Alga PSA development.

## Key Features

- **Pre-installed Dependencies**: npm dependencies are installed during the Docker build process to speed up environment startup
- **Development Tools**: Includes Node.js LTS, npm, git, kubectl, helm, and other essential tools
- **VS Code Extensions**: Pre-configured with TypeScript, Tailwind CSS, ESLint, and other useful extensions
- **Auto-configuration**: Git configuration and file watcher limits are automatically set

## Building the Image

There are two ways to build the code-server image:

### Option 1: Using the CLI (Recommended)
```bash
nu main.nu build-code-server --push
nu main.nu build-code-server --tag v1.0.0 --push
```

### Option 2: Using the build script directly
```bash
cd docker/dev-env
./build-code-server.sh [TAG]
```

If no tag is specified, it defaults to `latest`.

**Important**: The Docker build is executed from the project root directory to access all package.json files. All paths in the Dockerfile are relative to the project root.

## Speed Optimizations

The Dockerfile has been optimized to pre-install npm dependencies during the build phase:

1. **Layer Caching**: Package files are copied first, allowing Docker to cache the dependency installation layer
2. **Pre-installation**: Dependencies for the root project, server, and AI automation tools are installed during build
3. **Smart Updates**: The startup script only runs npm install if dependencies have changed

This reduces the startup time from several minutes to seconds for new environments.

## Files

- `Dockerfile.code-server`: The main Dockerfile for building the code-server image
- `start-dev-env.sh`: Startup script that configures the environment and starts code-server
- `build-code-server.sh`: Build script for creating and pushing the image
- `config/settings.json`: VS Code settings for the development environment
- `config/extensions.json`: List of VS Code extensions to install