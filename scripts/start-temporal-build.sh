#!/bin/bash
set -euo pipefail

# Script to start temporal worker build workflow with latest commit SHA
# Ensures proper error handling and prevents SHA mistakes

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
REPO_URL="https://github.com/Nine-Minds/alga-psa.git"
SET_LATEST="true"
WORKFLOW_TEMPLATE="temporal-worker-build"

# Function to get latest commit SHA
get_latest_sha() {
    local sha=$(git rev-parse HEAD)
    if [ -z "$sha" ]; then
        echo -e "${RED}Error: Failed to get latest commit SHA${NC}" >&2
        exit 1
    fi
    echo "$sha"
}

# Function to check if working directory is clean
check_working_directory() {
    if ! git diff --quiet || ! git diff --cached --quiet; then
        echo -e "${YELLOW}Warning: You have uncommitted changes${NC}"
        echo "The Kubernetes build will use the code from GitHub at the specified commit."
        echo "Your local uncommitted changes will NOT be included in the build."
        echo ""
        read -p "Continue anyway? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo -e "${RED}Build cancelled${NC}"
            exit 1
        fi
    fi
}

# Function to check if commit is pushed
check_commit_pushed() {
    local sha=$1
    local current_branch=$(git branch --show-current)
    
    # Check if commit exists on remote
    if ! git branch -r --contains "$sha" | grep -q "origin/"; then
        echo -e "${RED}Error: Local commit $sha is not pushed to remote${NC}" >&2
        echo "The Kubernetes build needs the commit to be available on GitHub."
        echo "Please push your changes first: git push origin $current_branch"
        exit 1
    fi
    
    # Double-check by fetching and comparing
    git fetch origin "$current_branch" --quiet
    local remote_sha=$(git rev-parse "origin/$current_branch" 2>/dev/null || echo "")
    
    if [ -z "$remote_sha" ]; then
        echo -e "${RED}Error: Branch $current_branch doesn't exist on remote${NC}" >&2
        echo "Please push your branch first: git push -u origin $current_branch"
        exit 1
    fi
    
    # Check if our commit is an ancestor of the remote branch
    if ! git merge-base --is-ancestor "$sha" "$remote_sha"; then
        echo -e "${RED}Error: Local commit $sha is not on remote branch $current_branch${NC}" >&2
        echo "The Kubernetes build needs the commit to be available on GitHub."
        echo "Please push your changes first: git push origin $current_branch"
        exit 1
    fi
}

# Function to create workflow YAML
create_workflow_yaml() {
    local sha=$1
    local workflow_file="/tmp/temporal-worker-build-${sha:0:7}.yaml"
    
    cat > "$workflow_file" << EOF
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  generateName: temporal-worker-build-auto-
  namespace: argo
spec:
  workflowTemplateRef:
    name: ${WORKFLOW_TEMPLATE}
  arguments:
    parameters:
    - name: repo-url
      value: "${REPO_URL}"
    - name: commit-sha
      value: "${sha}"
    - name: set-latest
      value: "${SET_LATEST}"
EOF

    echo "$workflow_file"
}

# Function to submit workflow
submit_workflow() {
    local workflow_file=$1
    local output
    
    echo -e "${GREEN}Submitting workflow...${NC}"
    
    # Submit workflow and capture output
    if output=$(kubectl apply -f "$workflow_file" 2>&1); then
        local workflow_name=$(echo "$output" | grep -o 'workflow.argoproj.io/[^ ]*' | cut -d'/' -f2)
        echo -e "${GREEN}Workflow submitted successfully: ${workflow_name}${NC}"
        echo ""
        echo "Commands to monitor the build:"
        echo "  Watch logs:    kubectl logs -n argo -f ${workflow_name}"
        echo "  Check status:  kubectl get workflow -n argo ${workflow_name}"
        echo "  View details:  kubectl describe workflow -n argo ${workflow_name}"
        return 0
    else
        echo -e "${RED}Failed to submit workflow${NC}" >&2
        echo "$output" >&2
        return 1
    fi
}

# Main execution
main() {
    echo -e "${GREEN}=== Temporal Worker Build Script ===${NC}"
    echo ""
    
    # Check if we're in a git repository
    if ! git rev-parse --git-dir > /dev/null 2>&1; then
        echo -e "${RED}Error: Not in a git repository${NC}" >&2
        exit 1
    fi
    
    # Get latest SHA
    echo "Getting latest commit SHA..."
    SHA=$(get_latest_sha)
    echo "Latest commit: ${SHA}"
    echo ""
    
    # Check working directory
    check_working_directory
    
    # Check if commit is pushed
    echo "Checking if commit is pushed to remote..."
    check_commit_pushed "$SHA"
    echo -e "${GREEN}✓ Commit is pushed to remote${NC}"
    echo ""
    
    # Show commit info
    echo "Commit details:"
    git log -1 --oneline "$SHA"
    echo ""
    
    # Create workflow YAML
    WORKFLOW_FILE=$(create_workflow_yaml "$SHA")
    echo "Created workflow file: $WORKFLOW_FILE"
    echo ""
    
    # Submit workflow
    if submit_workflow "$WORKFLOW_FILE"; then
        echo ""
        echo -e "${GREEN}✓ Build workflow started successfully${NC}"
        
        # Clean up
        rm -f "$WORKFLOW_FILE"
    else
        echo ""
        echo -e "${RED}✗ Failed to start build workflow${NC}"
        echo "Workflow file preserved at: $WORKFLOW_FILE"
        exit 1
    fi
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --no-latest)
            SET_LATEST="false"
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --no-latest    Don't set the 'latest' tag on successful build"
            echo "  --help, -h     Show this help message"
            echo ""
            echo "This script will:"
            echo "  1. Get the latest commit SHA from your local repository"
            echo "  2. Verify the commit is pushed to GitHub"
            echo "  3. Submit a temporal worker build workflow to Argo"
            echo "  4. Provide commands to monitor the build progress"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}" >&2
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Run main function
main