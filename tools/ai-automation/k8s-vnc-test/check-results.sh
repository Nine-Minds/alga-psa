#!/bin/bash

# Script to check and analyze test results

NAMESPACE="vnc-test"

echo "=== VNC/Xvfb Test Results Analysis ==="
echo "Checking namespace: $NAMESPACE"
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check each test pod
check_pod() {
    local app_label=$1
    local description=$2
    
    echo "=== $description ==="
    
    # Get pod name
    local pod_name=$(kubectl get pods -n "$NAMESPACE" -l app="$app_label" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
    
    if [ -z "$pod_name" ]; then
        echo -e "${RED}✗ Pod not found${NC}"
        return
    fi
    
    # Get pod status
    local pod_status=$(kubectl get pod -n "$NAMESPACE" "$pod_name" -o jsonpath='{.status.phase}')
    local ready=$(kubectl get pod -n "$NAMESPACE" "$pod_name" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}')
    
    echo "Pod: $pod_name"
    echo -n "Status: "
    if [ "$pod_status" == "Running" ] && [ "$ready" == "True" ]; then
        echo -e "${GREEN}✓ Running${NC}"
    else
        echo -e "${RED}✗ $pod_status (Ready: $ready)${NC}"
    fi
    
    # Check for Xvfb process
    echo -n "Xvfb status: "
    if kubectl exec -n "$NAMESPACE" "$pod_name" -- pgrep -f "Xvfb" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Running${NC}"
        
        # Get Xvfb details
        kubectl exec -n "$NAMESPACE" "$pod_name" -- ps aux | grep Xvfb | grep -v grep || true
    else
        echo -e "${RED}✗ Not running${NC}"
        
        # Check logs for errors
        echo "Recent error logs:"
        kubectl logs -n "$NAMESPACE" "$pod_name" --tail=20 | grep -E "ERROR|error|failed|Failed" || echo "No obvious errors in recent logs"
    fi
    
    # Memory usage
    echo "Memory usage:"
    kubectl exec -n "$NAMESPACE" "$pod_name" -- cat /proc/meminfo | grep -E "MemTotal|MemFree|MemAvailable" 2>/dev/null || echo "Could not get memory info"
    
    # Resource limits
    echo "Resource limits:"
    kubectl get pod -n "$NAMESPACE" "$pod_name" -o jsonpath='{.spec.containers[0].resources}' | python3 -m json.tool 2>/dev/null || echo "Could not get resource info"
    
    echo ""
}

# Summary function
show_summary() {
    echo "=== SUMMARY ==="
    
    # Count successful Xvfb instances
    local success_count=0
    local total_count=0
    
    for app in xvfb-test-minimal xvfb-test-standard xvfb-test-nonroot vnc-test-full; do
        local pod_name=$(kubectl get pods -n "$NAMESPACE" -l app="$app" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
        if [ -n "$pod_name" ]; then
            total_count=$((total_count + 1))
            if kubectl exec -n "$NAMESPACE" "$pod_name" -- pgrep -f "Xvfb" > /dev/null 2>&1; then
                success_count=$((success_count + 1))
                echo -e "${GREEN}✓${NC} $app: Xvfb running"
            else
                echo -e "${RED}✗${NC} $app: Xvfb not running"
            fi
        fi
    done
    
    echo ""
    echo "Success rate: $success_count/$total_count"
    
    # Recommendations
    echo ""
    echo "=== RECOMMENDATIONS ==="
    
    if [ $success_count -eq 0 ]; then
        echo -e "${RED}Critical:${NC} No Xvfb instances are running successfully."
        echo "- Check if the cluster has sufficient resources"
        echo "- Review security policies that might prevent X11 socket creation"
        echo "- Consider using xvfb-run wrapper instead of direct Xvfb"
    elif [ $success_count -lt $total_count ]; then
        echo -e "${YELLOW}Warning:${NC} Some Xvfb instances failed."
        echo "- Compare successful vs failed configurations"
        echo "- Check resource limits on failed pods"
        echo "- Review logs for specific error messages"
    else
        echo -e "${GREEN}Success:${NC} All Xvfb instances are running!"
        echo "- Use the working configuration in production"
        echo "- Consider the resource usage for capacity planning"
    fi
}

# Get detailed logs
get_detailed_logs() {
    local app_label=$1
    local output_file="$2"
    
    local pod_name=$(kubectl get pods -n "$NAMESPACE" -l app="$app_label" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
    
    if [ -n "$pod_name" ]; then
        echo "Collecting logs for $pod_name..."
        {
            echo "=== Pod: $pod_name ==="
            echo "=== Full logs ==="
            kubectl logs -n "$NAMESPACE" "$pod_name"
            echo ""
            echo "=== Pod description ==="
            kubectl describe pod -n "$NAMESPACE" "$pod_name"
            echo ""
            echo "=== Events ==="
            kubectl get events -n "$NAMESPACE" --field-selector involvedObject.name="$pod_name"
        } > "$output_file"
        echo "Logs saved to: $output_file"
    fi
}

# Main execution
echo "Checking individual test results..."
echo ""

check_pod "xvfb-test-minimal" "Minimal Xvfb Test"
check_pod "xvfb-test-standard" "Standard Xvfb Test"
check_pod "xvfb-test-nonroot" "Non-root Xvfb Test"
check_pod "vnc-test-full" "Full VNC Test"

show_summary

# Option to collect detailed logs
echo ""
read -p "Collect detailed logs? (y/n): " collect_logs
if [ "$collect_logs" == "y" ]; then
    mkdir -p ./logs
    get_detailed_logs "xvfb-test-minimal" "./logs/minimal-test.log"
    get_detailed_logs "xvfb-test-standard" "./logs/standard-test.log"
    get_detailed_logs "xvfb-test-nonroot" "./logs/nonroot-test.log"
    get_detailed_logs "vnc-test-full" "./logs/full-vnc-test.log"
    echo "All logs collected in ./logs/"
fi