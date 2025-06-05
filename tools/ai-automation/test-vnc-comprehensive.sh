#!/bin/bash

# Comprehensive VNC testing script that checks for various failure modes

echo "=== Comprehensive VNC Testing Script ==="
echo "This script tests VNC startup under various conditions"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test results
declare -a test_results=()

# Function to run a test
run_test() {
    local test_name=$1
    local test_command=$2
    
    echo -e "${YELLOW}Running test: $test_name${NC}"
    
    if eval "$test_command"; then
        echo -e "${GREEN}✓ PASSED${NC}"
        test_results+=("PASS: $test_name")
    else
        echo -e "${RED}✗ FAILED${NC}"
        test_results+=("FAIL: $test_name")
    fi
    echo ""
}

# Test 1: Check for required binaries
test_binaries() {
    local missing=0
    for binary in Xvfb x11vnc fluxbox websockify xdpyinfo; do
        if ! command -v $binary &> /dev/null; then
            echo "Missing: $binary"
            missing=1
        fi
    done
    return $missing
}

# Test 2: Check OpenGL/DRI issues
test_dri_compatibility() {
    echo "Testing DRI/OpenGL compatibility..."
    
    # Set software rendering environment
    export LIBGL_ALWAYS_SOFTWARE=1
    export GALLIUM_DRIVER=llvmpipe
    
    # Try to start Xvfb with GLX disabled
    Xvfb :99 -screen 0 640x480x8 -ac -extension GLX > /tmp/test_xvfb.log 2>&1 &
    local xvfb_pid=$!
    sleep 2
    
    if kill -0 $xvfb_pid 2>/dev/null; then
        kill $xvfb_pid
        return 0
    else
        echo "Xvfb crashed. Log:"
        tail -20 /tmp/test_xvfb.log
        return 1
    fi
}

# Test 3: Memory stress test
test_memory_constraints() {
    echo "Testing under memory constraints..."
    
    # Check available memory
    local mem_available=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
    echo "Available memory: ${mem_available}MB"
    
    if [ "$mem_available" -lt 256 ]; then
        echo "Low memory detected - using minimal config"
        Xvfb :99 -screen 0 320x240x8 -ac > /tmp/test_xvfb_mem.log 2>&1 &
    else
        Xvfb :99 -screen 0 800x600x16 -ac > /tmp/test_xvfb_mem.log 2>&1 &
    fi
    
    local xvfb_pid=$!
    sleep 2
    
    if kill -0 $xvfb_pid 2>/dev/null; then
        kill $xvfb_pid
        return 0
    else
        return 1
    fi
}

# Test 4: Shared memory availability
test_shm_availability() {
    echo "Testing shared memory availability..."
    
    if [ -d "/dev/shm" ]; then
        local shm_size=$(df -h /dev/shm | awk 'NR==2 {print $4}')
        echo "Shared memory available: $shm_size"
        
        # Try to create a test file
        if touch /dev/shm/test_vnc_shm 2>/dev/null; then
            rm -f /dev/shm/test_vnc_shm
            return 0
        else
            echo "Cannot write to /dev/shm"
            return 1
        fi
    else
        echo "/dev/shm not available"
        return 1
    fi
}

# Test 5: Display connectivity
test_display_connectivity() {
    echo "Testing display connectivity..."
    
    # Start a minimal Xvfb
    Xvfb :99 -screen 0 640x480x8 -ac > /tmp/test_xvfb_display.log 2>&1 &
    local xvfb_pid=$!
    sleep 2
    
    if kill -0 $xvfb_pid 2>/dev/null; then
        # Test with xdpyinfo
        if DISPLAY=:99 timeout 5 xdpyinfo > /tmp/test_xdpyinfo.log 2>&1; then
            kill $xvfb_pid
            return 0
        else
            echo "xdpyinfo failed:"
            cat /tmp/test_xdpyinfo.log
            kill $xvfb_pid
            return 1
        fi
    else
        return 1
    fi
}

# Test 6: Full VNC stack
test_full_vnc_stack() {
    echo "Testing full VNC stack..."
    
    # Cleanup first
    pkill -f "Xvfb :99" 2>/dev/null || true
    rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
    sleep 1
    
    # Start with safe options
    export LIBGL_ALWAYS_SOFTWARE=1
    Xvfb :99 -screen 0 800x600x16 -ac -extension GLX > /tmp/test_xvfb_full.log 2>&1 &
    local xvfb_pid=$!
    sleep 2
    
    if ! kill -0 $xvfb_pid 2>/dev/null; then
        echo "Xvfb failed to start"
        return 1
    fi
    
    # Start x11vnc
    DISPLAY=:99 x11vnc -nopw -rfbport 5901 > /tmp/test_x11vnc.log 2>&1 &
    local x11vnc_pid=$!
    sleep 2
    
    if ! kill -0 $x11vnc_pid 2>/dev/null; then
        echo "x11vnc failed to start"
        kill $xvfb_pid
        return 1
    fi
    
    # Cleanup
    kill $x11vnc_pid $xvfb_pid 2>/dev/null
    return 0
}

# Main test execution
echo "Starting comprehensive VNC tests..."
echo "=================================="
echo ""

run_test "Required binaries" test_binaries
run_test "DRI/OpenGL compatibility" test_dri_compatibility
run_test "Memory constraints" test_memory_constraints
run_test "Shared memory availability" test_shm_availability
run_test "Display connectivity" test_display_connectivity
run_test "Full VNC stack" test_full_vnc_stack

# Summary
echo "=================================="
echo "Test Summary:"
echo ""

pass_count=0
fail_count=0

for result in "${test_results[@]}"; do
    if [[ $result == PASS* ]]; then
        echo -e "${GREEN}$result${NC}"
        ((pass_count++))
    else
        echo -e "${RED}$result${NC}"
        ((fail_count++))
    fi
done

echo ""
echo "Total: $pass_count passed, $fail_count failed"

# Exit with failure if any test failed
[ $fail_count -eq 0 ]