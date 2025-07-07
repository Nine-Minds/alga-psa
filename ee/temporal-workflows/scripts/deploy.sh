#!/bin/bash

# Temporal Workflows Deployment Script
# This script builds and deploys the temporal workflows service

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
IMAGE_NAME="temporal-workflows"
REGISTRY="${DOCKER_REGISTRY:-your-registry}"
TAG="${BUILD_TAG:-latest}"
NAMESPACE="${KUBERNETES_NAMESPACE:-default}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Help function
show_help() {
    cat << EOF
Temporal Workflows Deployment Script

Usage: $0 [OPTIONS] COMMAND

Commands:
    build           Build Docker image
    push            Push Docker image to registry
    deploy          Deploy to Kubernetes
    deploy-local    Deploy using local Docker image
    rollback        Rollback to previous deployment
    status          Check deployment status
    logs            Show worker logs
    clean           Clean up resources

Options:
    -h, --help      Show this help message
    -t, --tag TAG   Docker image tag (default: latest)
    -r, --registry  Docker registry (default: your-registry)
    -n, --namespace Kubernetes namespace (default: default)
    --dry-run       Show what would be done without executing

Examples:
    $0 build
    $0 -t v1.2.3 deploy
    $0 --registry myregistry.com deploy
    $0 rollback
    $0 logs
EOF
}

# Parse command line arguments
DRY_RUN=false
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        -t|--tag)
            TAG="$2"
            shift 2
            ;;
        -r|--registry)
            REGISTRY="$2"
            shift 2
            ;;
        -n|--namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        -*)
            log_error "Unknown option $1"
            show_help
            exit 1
            ;;
        *)
            COMMAND="$1"
            shift
            break
            ;;
    esac
done

# Validate required tools
check_dependencies() {
    local deps=("docker" "kubectl")
    for dep in "${deps[@]}"; do
        if ! command -v "$dep" &> /dev/null; then
            log_error "$dep is required but not installed"
            exit 1
        fi
    done
}

# Build Docker image
build_image() {
    log_info "Building Docker image: ${REGISTRY}/${IMAGE_NAME}:${TAG}"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY RUN] Would build: docker build -t ${REGISTRY}/${IMAGE_NAME}:${TAG} ."
        return
    fi
    
    cd "$PROJECT_DIR"
    docker build -t "${REGISTRY}/${IMAGE_NAME}:${TAG}" .
    
    log_info "Image built successfully"
}

# Push Docker image
push_image() {
    log_info "Pushing Docker image: ${REGISTRY}/${IMAGE_NAME}:${TAG}"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY RUN] Would push: docker push ${REGISTRY}/${IMAGE_NAME}:${TAG}"
        return
    fi
    
    docker push "${REGISTRY}/${IMAGE_NAME}:${TAG}"
    
    log_info "Image pushed successfully"
}

# Deploy to Kubernetes
deploy_k8s() {
    log_info "Deploying to Kubernetes namespace: ${NAMESPACE}"
    
    # Update image in deployment
    local deployment_file="${PROJECT_DIR}/k8s/deployment.yaml"
    local temp_file=$(mktemp)
    
    # Replace image placeholder
    sed "s|your-registry/temporal-workflows:latest|${REGISTRY}/${IMAGE_NAME}:${TAG}|g" \
        "$deployment_file" > "$temp_file"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY RUN] Would apply Kubernetes manifests"
        log_info "[DRY RUN] Image: ${REGISTRY}/${IMAGE_NAME}:${TAG}"
        rm "$temp_file"
        return
    fi
    
    # Apply the manifests
    kubectl apply -f "$temp_file" -n "$NAMESPACE"
    
    # Clean up
    rm "$temp_file"
    
    log_info "Deployment applied successfully"
    
    # Wait for rollout
    log_info "Waiting for deployment to complete..."
    kubectl rollout status deployment/temporal-workflows-worker -n "$NAMESPACE" --timeout=300s
    
    log_info "Deployment completed successfully"
}

# Deploy using local image (for development)
deploy_local() {
    log_info "Deploying using local Docker image"
    
    # Build image locally
    build_image
    
    # Use local registry or kind cluster
    if command -v kind &> /dev/null; then
        log_info "Loading image into kind cluster"
        if [[ "$DRY_RUN" != "true" ]]; then
            kind load docker-image "${REGISTRY}/${IMAGE_NAME}:${TAG}"
        fi
    fi
    
    # Deploy
    deploy_k8s
}

# Rollback deployment
rollback_deployment() {
    log_info "Rolling back deployment"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY RUN] Would rollback: kubectl rollout undo deployment/temporal-workflows-worker"
        return
    fi
    
    kubectl rollout undo deployment/temporal-workflows-worker -n "$NAMESPACE"
    kubectl rollout status deployment/temporal-workflows-worker -n "$NAMESPACE" --timeout=300s
    
    log_info "Rollback completed successfully"
}

# Check deployment status
check_status() {
    log_info "Checking deployment status"
    
    echo "Deployment status:"
    kubectl get deployment temporal-workflows-worker -n "$NAMESPACE" -o wide
    
    echo -e "\nPod status:"
    kubectl get pods -l app=temporal-workflows-worker -n "$NAMESPACE" -o wide
    
    echo -e "\nService status:"
    kubectl get service temporal-workflows-worker -n "$NAMESPACE" -o wide
    
    echo -e "\nHPA status:"
    kubectl get hpa temporal-workflows-worker-hpa -n "$NAMESPACE" 2>/dev/null || echo "HPA not found"
}

# Show logs
show_logs() {
    log_info "Showing worker logs"
    
    kubectl logs -l app=temporal-workflows-worker -n "$NAMESPACE" --tail=100 -f
}

# Clean up resources
clean_up() {
    log_info "Cleaning up resources"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY RUN] Would delete Kubernetes resources"
        return
    fi
    
    kubectl delete -f "${PROJECT_DIR}/k8s/deployment.yaml" -n "$NAMESPACE" || true
    
    log_info "Cleanup completed"
}

# Main execution
main() {
    if [[ -z "${COMMAND:-}" ]]; then
        log_error "No command specified"
        show_help
        exit 1
    fi
    
    check_dependencies
    
    case "$COMMAND" in
        build)
            build_image
            ;;
        push)
            push_image
            ;;
        deploy)
            build_image
            push_image
            deploy_k8s
            ;;
        deploy-local)
            deploy_local
            ;;
        rollback)
            rollback_deployment
            ;;
        status)
            check_status
            ;;
        logs)
            show_logs
            ;;
        clean)
            clean_up
            ;;
        *)
            log_error "Unknown command: $COMMAND"
            show_help
            exit 1
            ;;
    esac
}

# Run main function
main "$@"