#!/bin/bash

# Deployment script for VNC/Xvfb Kubernetes tests

set -e

NAMESPACE="vnc-test"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== VNC/Xvfb Kubernetes Test Deployment ==="
echo "Script directory: $SCRIPT_DIR"
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Helper functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_step "Checking prerequisites..."
    
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl not found. Please install kubectl."
        exit 1
    fi
    
    if ! kubectl cluster-info &> /dev/null; then
        log_error "Cannot connect to Kubernetes cluster. Please check your kubeconfig."
        exit 1
    fi
    
    log_info "Prerequisites check passed"
}

# Create namespace
create_namespace() {
    log_step "Creating namespace '$NAMESPACE'..."
    
    if kubectl get namespace "$NAMESPACE" &> /dev/null; then
        log_warn "Namespace '$NAMESPACE' already exists"
    else
        kubectl apply -f "$SCRIPT_DIR/namespace.yaml"
        log_info "Namespace created"
    fi
}

# Build test image (optional, for full test)
build_test_image() {
    log_step "Building test Docker image..."
    
    if command -v docker &> /dev/null; then
        cd "$SCRIPT_DIR"
        docker build -f Dockerfile.test -t ai-automation:test .
        log_info "Test image built successfully"
    else
        log_warn "Docker not found, skipping image build. Full VNC test will use existing image."
    fi
}

# Deploy tests
deploy_tests() {
    log_step "Deploying test configurations..."
    
    # Deploy minimal test
    log_info "Deploying minimal Xvfb test..."
    kubectl apply -f "$SCRIPT_DIR/test-xvfb-minimal.yaml"
    
    # Deploy standard test
    log_info "Deploying standard Xvfb test..."
    kubectl apply -f "$SCRIPT_DIR/test-xvfb-standard.yaml"
    
    # Deploy non-root test
    log_info "Deploying non-root Xvfb test..."
    kubectl apply -f "$SCRIPT_DIR/test-xvfb-nonroot.yaml"
    
    # Deploy full VNC test if image exists
    if docker images | grep -q "ai-automation.*test"; then
        log_info "Deploying full VNC test..."
        kubectl apply -f "$SCRIPT_DIR/test-vnc-full.yaml"
    else
        log_warn "Skipping full VNC test (image not found)"
    fi
    
    log_info "All tests deployed"
}

# Wait for pods
wait_for_pods() {
    log_step "Waiting for pods to be ready..."
    
    local timeout=120
    local elapsed=0
    
    while [ $elapsed -lt $timeout ]; do
        local ready_pods=$(kubectl get pods -n "$NAMESPACE" --no-headers | grep -c "Running\|Completed" || true)
        local total_pods=$(kubectl get pods -n "$NAMESPACE" --no-headers | wc -l || true)
        
        if [ "$ready_pods" -eq "$total_pods" ] && [ "$total_pods" -gt 0 ]; then
            log_info "All pods are ready ($ready_pods/$total_pods)"
            break
        fi
        
        echo -ne "\rWaiting for pods... ($ready_pods/$total_pods ready, ${elapsed}s elapsed)"
        sleep 5
        elapsed=$((elapsed + 5))
    done
    
    echo ""
    
    if [ $elapsed -ge $timeout ]; then
        log_warn "Timeout waiting for pods. Current status:"
        kubectl get pods -n "$NAMESPACE"
    fi
}

# Show status
show_status() {
    log_step "Current deployment status..."
    
    echo ""
    echo "=== Pods ==="
    kubectl get pods -n "$NAMESPACE" -o wide
    
    echo ""
    echo "=== Services ==="
    kubectl get svc -n "$NAMESPACE"
    
    echo ""
    echo "=== Recent Events ==="
    kubectl get events -n "$NAMESPACE" --sort-by='.lastTimestamp' | tail -10
}

# Show logs helper
show_logs() {
    local pod_name=$1
    log_info "Logs for $pod_name:"
    kubectl logs -n "$NAMESPACE" "$pod_name" --tail=50 || log_error "Failed to get logs for $pod_name"
    echo ""
}

# Main menu
show_menu() {
    echo ""
    echo "=== Test Management ==="
    echo "1) Deploy all tests"
    echo "2) Show status"
    echo "3) Show logs (minimal test)"
    echo "4) Show logs (standard test)"
    echo "5) Show logs (non-root test)"
    echo "6) Show logs (full VNC test)"
    echo "7) Connect to pod (interactive)"
    echo "8) Clean up all tests"
    echo "9) Exit"
    echo ""
    read -p "Select option: " choice
    
    case $choice in
        1)
            check_prerequisites
            create_namespace
            build_test_image
            deploy_tests
            wait_for_pods
            show_status
            ;;
        2)
            show_status
            ;;
        3)
            pod=$(kubectl get pods -n "$NAMESPACE" -l app=xvfb-test-minimal -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
            [ -n "$pod" ] && show_logs "$pod" || log_error "Minimal test pod not found"
            ;;
        4)
            pod=$(kubectl get pods -n "$NAMESPACE" -l app=xvfb-test-standard -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
            [ -n "$pod" ] && show_logs "$pod" || log_error "Standard test pod not found"
            ;;
        5)
            pod=$(kubectl get pods -n "$NAMESPACE" -l app=xvfb-test-nonroot -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
            [ -n "$pod" ] && show_logs "$pod" || log_error "Non-root test pod not found"
            ;;
        6)
            pod=$(kubectl get pods -n "$NAMESPACE" -l app=vnc-test-full -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
            [ -n "$pod" ] && show_logs "$pod" || log_error "Full VNC test pod not found"
            ;;
        7)
            echo "Available pods:"
            kubectl get pods -n "$NAMESPACE" --no-headers | awk '{print NR") " $1}'
            read -p "Select pod number: " pod_num
            pod=$(kubectl get pods -n "$NAMESPACE" --no-headers | awk "NR==$pod_num {print \$1}")
            if [ -n "$pod" ]; then
                log_info "Connecting to $pod..."
                kubectl exec -it -n "$NAMESPACE" "$pod" -- /bin/bash
            else
                log_error "Invalid selection"
            fi
            ;;
        8)
            log_warn "Cleaning up all tests..."
            kubectl delete namespace "$NAMESPACE" --wait=false
            log_info "Cleanup initiated"
            ;;
        9)
            exit 0
            ;;
        *)
            log_error "Invalid option"
            ;;
    esac
    
    # Show menu again unless exiting
    [ "$choice" != "9" ] && show_menu
}

# Run quick deployment if --quick flag is provided
if [ "$1" == "--quick" ]; then
    check_prerequisites
    create_namespace
    deploy_tests
    wait_for_pods
    show_status
else
    # Interactive mode
    show_menu
fi