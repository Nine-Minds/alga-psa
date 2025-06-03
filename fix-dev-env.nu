#!/usr/bin/env nu

# Complete dev environment cleanup and recreation script
def main [pr_number: int] {
    let namespace = $"alga-pr-($pr_number)"
    
    print "🧹 Complete cleanup and recreation of dev environment"
    
    # Step 1: Remove any existing Helm releases
    print "1. Cleaning up Helm releases..."
    helm uninstall $"alga-pr-($pr_number)" -n $namespace --timeout=30s | complete
    helm uninstall $"alga-pr-($pr_number)" -n default --timeout=30s | complete
    
    # Step 2: Clean up hook jobs that might be stuck
    print "2. Cleaning up stuck jobs..."
    kubectl delete jobs --all -n $namespace --timeout=30s | complete
    
    # Step 3: Clean up all resources
    print "3. Cleaning up all resources..."
    kubectl delete all --all -n $namespace --timeout=30s | complete
    kubectl delete pvc --all -n $namespace --timeout=30s | complete
    kubectl delete configmaps,secrets --all -n $namespace --timeout=30s | complete
    kubectl delete ingress --all -n $namespace --timeout=30s | complete
    
    # Step 4: Clean up persistent volumes
    print "4. Cleaning up persistent volumes..."
    let pv_list = (kubectl get pv | grep $namespace | awk '{print $1}' | lines)
    for pv in $pv_list {
        if ($pv | str trim | str length) > 0 {
            kubectl delete pv ($pv | str trim) --force --grace-period=0 | complete
        }
    }
    
    # Step 5: Force delete namespace
    print "5. Force deleting namespace..."
    kubectl delete namespace $namespace --force --grace-period=0 | complete
    
    # Step 6: Wait for complete cleanup
    print "6. Waiting for complete cleanup..."
    mut cleanup_complete = false
    mut attempts = 0
    while not $cleanup_complete and $attempts < 30 {
        let ns_check = (kubectl get namespace $namespace | complete)
        if $ns_check.exit_code != 0 {
            $cleanup_complete = true
        } else {
            sleep 2sec
            $attempts = $attempts + 1
        }
    }
    
    if $cleanup_complete {
        print "✅ Cleanup complete! Creating environment..."
        nu cli/main.nu dev-env-create $pr_number --edition ee --ai-enabled
    } else {
        print "❌ Cleanup timed out. Manual intervention may be required."
    }
}