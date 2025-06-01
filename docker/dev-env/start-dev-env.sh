#!/bin/bash
set -e

echo "🚀 Starting Alga PSA Development Environment"
echo "PR: ${ALGA_PR_NUMBER:-unknown}"
echo "Branch: ${ALGA_BRANCH:-unknown}"

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

# Install dependencies if package.json exists
if [ -f "package.json" ]; then
    echo "📦 Installing Node.js dependencies..."
    npm install
fi

if [ -f "server/package.json" ]; then
    echo "📦 Installing server dependencies..."
    cd server && npm install && cd ..
fi

# Install tools dependencies if they exist
if [ -f "tools/ai-automation/package.json" ]; then
    echo "🤖 Installing AI automation dependencies..."
    cd tools/ai-automation && npm install && cd ../..
fi

# Start code-server
echo "🖥️  Starting code-server..."
exec /usr/bin/entrypoint.sh --bind-addr 0.0.0.0:8080 /home/coder/alga-psa