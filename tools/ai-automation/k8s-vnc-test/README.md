# VNC/Xvfb Kubernetes Testing Suite

This directory contains comprehensive tests to debug and resolve Xvfb/VNC issues in Kubernetes environments.

## Overview

The main issue is that Xvfb crashes in Kubernetes but works in local Docker. This test suite helps identify the root cause and find a working configuration.

## Test Components

### 1. Test Deployments

- **test-xvfb-minimal.yaml**: Minimal Xvfb setup with very basic configuration
- **test-xvfb-standard.yaml**: Tests multiple Xvfb configurations to find what works
- **test-xvfb-nonroot.yaml**: Tests running Xvfb as non-root user
- **test-vnc-full.yaml**: Full VNC setup with application
- **test-with-configmap.yaml**: Advanced test with fallback configurations

### 2. Scripts

- **deploy-test.sh**: Main deployment script with interactive menu
- **check-results.sh**: Analyzes test results and provides recommendations
- **improved-vnc-startup.sh**: Improved VNC startup script with better error handling
- **test-xvfb.sh**: Simple Xvfb testing script

### 3. Docker

- **Dockerfile.test**: Test container with all dependencies properly installed

## Quick Start

1. Deploy all tests:
   ```bash
   ./deploy-test.sh --quick
   ```

2. Check results:
   ```bash
   ./check-results.sh
   ```

3. Interactive management:
   ```bash
   ./deploy-test.sh
   ```

## Common Issues and Solutions

### Issue 1: Xvfb crashes immediately
**Symptoms**: Xvfb process starts but exits within seconds
**Possible causes**:
- Insufficient memory
- Missing X11 socket directory
- Permission issues
- Resource limits too restrictive

**Solutions**:
- Use minimal configuration: `-screen 0 640x480x8`
- Ensure `/tmp/.X11-unix` exists with 1777 permissions
- Increase memory limits
- Use init container to set up directories

### Issue 2: Display test fails
**Symptoms**: Xvfb runs but `xdpyinfo` fails
**Possible causes**:
- DISPLAY variable not set correctly
- X11 authentication issues
- Network isolation

**Solutions**:
- Export `DISPLAY=:99` explicitly
- Use `-ac` flag to disable access control
- Add `-nolisten tcp` to disable TCP connections

### Issue 3: Non-root user issues
**Symptoms**: Permission denied errors when running as non-root
**Possible causes**:
- Cannot write to `/tmp/.X11-unix`
- No access to required directories

**Solutions**:
- Use init container with root to set up directories
- Set `XDG_RUNTIME_DIR` to writable location
- Use emptyDir volumes for temp directories

## Recommended Configuration

Based on testing, here's the recommended approach:

1. **For resource-constrained environments**:
   ```bash
   Xvfb :99 -screen 0 1024x768x16 -ac -nolisten tcp
   ```

2. **For standard environments**:
   ```bash
   Xvfb :99 -screen 0 1280x1024x16 -ac -nolisten tcp +extension RANDR
   ```

3. **Fallback approach**:
   Use the ConfigMap-based deployment with automatic fallback to `xvfb-run`

## Production Recommendations

1. **Use init containers** to set up directories with proper permissions
2. **Implement health checks** using display tests
3. **Use resource limits** appropriate for your needs:
   - Minimum: 256Mi memory, 100m CPU
   - Recommended: 512Mi-1Gi memory, 200m-500m CPU
4. **Consider using `xvfb-run`** wrapper for simpler setups
5. **Monitor logs** for X11 errors and adjust configuration

## Debugging Tips

1. Check if Xvfb is running:
   ```bash
   kubectl exec -n vnc-test <pod-name> -- pgrep -f "Xvfb"
   ```

2. Test display:
   ```bash
   kubectl exec -n vnc-test <pod-name> -- sh -c "DISPLAY=:99 xdpyinfo"
   ```

3. View Xvfb logs:
   ```bash
   kubectl logs -n vnc-test <pod-name> | grep -i xvfb
   ```

4. Check memory usage:
   ```bash
   kubectl exec -n vnc-test <pod-name> -- cat /proc/meminfo
   ```

## Cleanup

Remove all test resources:
```bash
kubectl delete namespace vnc-test
```