#!/bin/bash
set -e

echo "🚀 Starting Alga PSA Development Environment"
echo "PR: ${ALGA_PR_NUMBER:-unknown}"
echo "Branch: ${ALGA_BRANCH:-unknown}"

# Increase file watcher limits for development
echo "⚙️  Configuring file watcher limits..."
sudo sysctl -w fs.inotify.max_user_watches=524288 || echo "Warning: Could not set max_user_watches"
sudo sysctl -w fs.inotify.max_user_instances=256 || echo "Warning: Could not set max_user_instances"

# Configure git if environment variables are set
if [ -n "$GIT_AUTHOR_NAME" ]; then
    git config --global user.name "$GIT_AUTHOR_NAME"
fi
if [ -n "$GIT_AUTHOR_EMAIL" ]; then
    git config --global user.email "$GIT_AUTHOR_EMAIL"
fi

# Set up workspace permissions
sudo chown -R coder:coder /home/coder/alga-psa

# Navigate to project directory
cd /home/coder/alga-psa

# Install/update dependencies if package.json exists
# Check if node_modules exists and package.json has changed
if [ -f "package.json" ]; then
    if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules" ]; then
        echo "📦 Installing/updating Node.js dependencies..."
        npm install
    else
        echo "✅ Root dependencies already installed"
    fi
fi

if [ -f "server/package.json" ]; then
    if [ ! -d "server/node_modules" ] || [ "server/package.json" -nt "server/node_modules" ]; then
        echo "📦 Installing/updating server dependencies..."
        cd server && npm install && cd ..
    else
        echo "✅ Server dependencies already installed"
    fi
fi

# Install tools dependencies if they exist
if [ -f "tools/ai-automation/package.json" ]; then
    if [ ! -d "tools/ai-automation/node_modules" ] || [ "tools/ai-automation/package.json" -nt "tools/ai-automation/node_modules" ]; then
        echo "🤖 Installing/updating AI automation dependencies..."
        cd tools/ai-automation && npm install && cd ../..
    else
        echo "✅ AI automation dependencies already installed"
    fi
fi

# Start code-server
echo "🖥️  Starting code-server..."
exec /usr/bin/entrypoint.sh --bind-addr 0.0.0.0:8080 /home/coder/alga-psa