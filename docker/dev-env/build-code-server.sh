#!/bin/bash
set -e

# Build and push the Alga PSA code-server image

# Default values
REGISTRY="harbor.nineminds.com"
NAMESPACE="nineminds"
IMAGE_NAME="alga-code-server"
TAG="${1:-latest}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Building Alga PSA Code Server image...${NC}"
echo -e "${YELLOW}Registry: ${REGISTRY}/${NAMESPACE}/${IMAGE_NAME}:${TAG}${NC}"

# Build the image from the project root to have access to package.json files
cd ../..
echo -e "${GREEN}Building from project root: $(pwd)${NC}"
echo -e "${YELLOW}Note: Building from project root, all paths in Dockerfile are relative to project root${NC}"

# Build the Docker image
echo -e "${YELLOW}Build output will be streamed to terminal...${NC}"
docker build \
    --platform linux/amd64 \
    -f docker/dev-env/Dockerfile.code-server \
    -t "${REGISTRY}/${NAMESPACE}/${IMAGE_NAME}:${TAG}" \
    .

# Check if build succeeded
if [ $? -eq 0 ]; then
    echo -e "${GREEN}Build completed successfully!${NC}"
else
    echo -e "${RED}Build failed!${NC}"
    exit 1
fi

# Ask if user wants to push
read -p "Do you want to push the image to the registry? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Pushing image to registry...${NC}"
    docker push "${REGISTRY}/${NAMESPACE}/${IMAGE_NAME}:${TAG}"
    echo -e "${GREEN}Push completed successfully!${NC}"
fi

echo -e "${GREEN}Done!${NC}"