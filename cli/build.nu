# Build Docker image for specified edition
export def build-image [
    edition: string,         # Edition to build (ce or ee) 
    --tag: string = ""       # Docker tag to use (defaults to unique tag)
    --push                   # Push to registry after building
    --use-latest             # Use 'latest' tag instead of unique tag
] {
    if not ($edition in ["ce", "ee"]) {
        error make { msg: $"($env.ALGA_COLOR_RED)Edition must be 'ce' or 'ee'($env.ALGA_COLOR_RESET)" }
    }
    
    print $"($env.ALGA_COLOR_CYAN)Building ($edition | str upcase) Docker image...($env.ALGA_COLOR_RESET)"
    
    let project_root = find-project-root
    cd $project_root
    
    # Determine image name and build context
    let image_name = $"harbor.nineminds.com/nineminds/alga-psa-($edition)"
    
    # Generate unique tag if not provided and not using latest
    let sha_tag = if ($tag | str length) > 0 {
        $tag
    } else {
        # Generate unique tag using git commit SHA only (consistent across calls)
        let git_sha = (git rev-parse --short HEAD | complete)
        
        if $git_sha.exit_code == 0 {
            let sha = ($git_sha.stdout | str trim)
            $sha
        } else {
            # Fallback if git is not available - use timestamp
            let timestamp = (date now | format date '%Y%m%d-%H%M%S')
            $"build-($timestamp)"
        }
    }
    
    # Build list of tags to apply
    let tags_to_apply = if $use_latest {
        # When --use-latest is specified, tag with both SHA and latest
        [$sha_tag, "latest"]
    } else {
        # Otherwise just use the single tag
        [$sha_tag]
    }
    
    # Build tag arguments for docker build
    let tag_args = ($tags_to_apply | each { |t| ["-t", $"($image_name):($t)"] } | flatten)
    
    # Build the image
    print $"($env.ALGA_COLOR_YELLOW)Building with tags: ($tags_to_apply | str join ', ')($env.ALGA_COLOR_RESET)"
    print $"($env.ALGA_COLOR_CYAN)Build output will be streamed to terminal...($env.ALGA_COLOR_RESET)"
    
    if $edition == "ee" {
        # EE build includes everything
        docker build --platform linux/amd64 -f server/Dockerfile ...$tag_args .
    } else {
        # CE build excludes EE directory
        docker build --platform linux/amd64 -f server/Dockerfile ...$tag_args --build-arg EXCLUDE_EE=true .
    }
    
    # Check if build succeeded by checking if image exists
    let image_check = do {
        docker image inspect $"($image_name):($sha_tag)" | complete
    }
    
    if $image_check.exit_code != 0 {
        print $"($env.ALGA_COLOR_RED)Build failed - image not created($env.ALGA_COLOR_RESET)"
        error make { msg: "Docker build failed" }
    }
    
    print $"($env.ALGA_COLOR_GREEN)Successfully built with tags: ($tags_to_apply | str join ', ')($env.ALGA_COLOR_RESET)"
    
    if $push {
        # Push all tags
        for tag in $tags_to_apply {
            let full_tag = $"($image_name):($tag)"
            print $"($env.ALGA_COLOR_YELLOW)Pushing: ($full_tag)($env.ALGA_COLOR_RESET)"
            print $"($env.ALGA_COLOR_CYAN)Push output will be streamed to terminal...($env.ALGA_COLOR_RESET)"
            
            # Push the image - stream output directly
            docker push $full_tag
            
            # Check if push succeeded
            let push_check = do {
                docker manifest inspect $full_tag | complete
            }
            
            if $push_check.exit_code != 0 {
                print $"($env.ALGA_COLOR_RED)Push may have failed for ($full_tag) - unable to verify image in registry($env.ALGA_COLOR_RESET)"
                print $"($env.ALGA_COLOR_YELLOW)Note: This could also mean the registry doesn't support manifest inspection($env.ALGA_COLOR_RESET)"
            } else {
                print $"($env.ALGA_COLOR_GREEN)Successfully pushed: ($full_tag)($env.ALGA_COLOR_RESET)"
            }
        }
    }
}

# Build Docker images for both CE and EE editions
export def build-all-images [
    --tag: string = "latest" # Docker tag to use
    --push                   # Push to registry after building
] {
    print $"($env.ALGA_COLOR_CYAN)Building all edition Docker images...($env.ALGA_COLOR_RESET)"
    
    # Build CE edition
    if $push {
        build-image "ce" --tag $tag --push
    } else {
        build-image "ce" --tag $tag
    }
    
    # Build EE edition  
    if $push {
        build-image "ee" --tag $tag --push
    } else {
        build-image "ee" --tag $tag
    }
    
    print $"($env.ALGA_COLOR_GREEN)All builds completed successfully!($env.ALGA_COLOR_RESET)"
}

# Build code-server Docker image
export def build-code-server [
    --tag: string = ""       # Docker tag to use (defaults to SHA)
    --push                   # Push to registry after building
    --use-latest             # Tag with both SHA and 'latest'
] {
    print $"($env.ALGA_COLOR_CYAN)Building code-server Docker image...($env.ALGA_COLOR_RESET)"
    
    let project_root = find-project-root
    cd $project_root
    
    # Determine image name
    let registry = "harbor.nineminds.com"
    let namespace = "nineminds"
    let image_name = "alga-code-server"
    let base_image = $"($registry)/($namespace)/($image_name)"
    
    # Generate SHA tag
    let sha_tag = if ($tag | str length) > 0 {
        $tag
    } else {
        # Generate unique tag using git commit SHA only (consistent across calls)
        let git_sha = (git rev-parse --short HEAD | complete)
        
        if $git_sha.exit_code == 0 {
            let sha = ($git_sha.stdout | str trim)
            $sha
        } else {
            # Fallback if git is not available - use timestamp
            let timestamp = (date now | format date '%Y%m%d-%H%M%S')
            $"build-($timestamp)"
        }
    }
    
    # Build list of tags to apply
    let tags_to_apply = if $use_latest {
        # When --use-latest is specified, tag with both SHA and latest
        [$sha_tag, "latest"]
    } else {
        # Otherwise just use the single tag
        [$sha_tag]
    }
    
    # Build tag arguments for docker build
    let tag_args = ($tags_to_apply | each { |t| ["-t", $"($base_image):($t)"] } | flatten)
    
    print $"($env.ALGA_COLOR_YELLOW)Building with tags: ($tags_to_apply | str join ', ')($env.ALGA_COLOR_RESET)"
    print $"($env.ALGA_COLOR_CYAN)Build output will be streamed to terminal...($env.ALGA_COLOR_RESET)"
    
    # Build the image - stream output directly
    docker build --platform linux/amd64 -f docker/dev-env/Dockerfile.code-server ...$tag_args .
    
    # Check if build succeeded by checking if image exists
    let image_check = do {
        docker image inspect $"($base_image):($sha_tag)" | complete
    }
    
    if $image_check.exit_code != 0 {
        print $"($env.ALGA_COLOR_RED)Build failed - image not created($env.ALGA_COLOR_RESET)"
        error make { msg: "Docker build failed" }
    }
    
    print $"($env.ALGA_COLOR_GREEN)Successfully built with tags: ($tags_to_apply | str join ', ')($env.ALGA_COLOR_RESET)"
    
    if $push {
        # Push all tags
        for tag in $tags_to_apply {
            let full_image = $"($base_image):($tag)"
            print $"($env.ALGA_COLOR_YELLOW)Pushing: ($full_image)($env.ALGA_COLOR_RESET)"
            print $"($env.ALGA_COLOR_CYAN)Push output will be streamed to terminal...($env.ALGA_COLOR_RESET)"
            
            # Push the image - stream output directly
            docker push $full_image
            
            # Check if push succeeded by trying to pull the image info from registry
            let push_check = do {
                docker manifest inspect $full_image | complete
            }
            
            if $push_check.exit_code != 0 {
                print $"($env.ALGA_COLOR_RED)Push may have failed for ($full_image) - unable to verify image in registry($env.ALGA_COLOR_RESET)"
                print $"($env.ALGA_COLOR_YELLOW)Note: This could also mean the registry doesn't support manifest inspection($env.ALGA_COLOR_RESET)"
            } else {
                print $"($env.ALGA_COLOR_GREEN)Successfully pushed: ($full_image)($env.ALGA_COLOR_RESET)"
            }
        }
    }
}

# Build AI API Docker image
export def build-ai-api [
    --tag: string = ""       # Docker tag to use (defaults to SHA)
    --push                   # Push to registry after building
    --use-latest             # Tag with both SHA and 'latest'
] {
    print $"($env.ALGA_COLOR_CYAN)Building AI API Docker image...($env.ALGA_COLOR_RESET)"
    
    let project_root = find-project-root
    cd $project_root
    
    # Determine image name
    let registry = "harbor.nineminds.com"
    let namespace = "nineminds"
    let image_name = "alga-ai-api"
    let base_image = $"($registry)/($namespace)/($image_name)"
    
    # Generate SHA tag
    let sha_tag = if ($tag | str length) > 0 {
        $tag
    } else {
        # Generate unique tag using git commit SHA only (consistent across calls)
        let git_sha = (git rev-parse --short HEAD | complete)
        
        if $git_sha.exit_code == 0 {
            let sha = ($git_sha.stdout | str trim)
            $sha
        } else {
            # Fallback if git is not available - use timestamp
            let timestamp = (date now | format date '%Y%m%d-%H%M%S')
            $"build-($timestamp)"
        }
    }
    
    # Build list of tags to apply
    let tags_to_apply = if $use_latest {
        # When --use-latest is specified, tag with both SHA and latest
        [$sha_tag, "latest"]
    } else {
        # Otherwise just use the single tag
        [$sha_tag]
    }
    
    # Build tag arguments for docker build
    let tag_args = ($tags_to_apply | each { |t| ["-t", $"($base_image):($t)"] } | flatten)
    
    print $"($env.ALGA_COLOR_YELLOW)Building with tags: ($tags_to_apply | str join ', ')($env.ALGA_COLOR_RESET)"
    print $"($env.ALGA_COLOR_CYAN)Build output will be streamed to terminal...($env.ALGA_COLOR_RESET)"
    
    # Build the image from the ai-automation directory
    cd ($project_root | path join "tools" "ai-automation")
    docker build --platform linux/amd64 -f Dockerfile ...$tag_args .
    
    # Check if build succeeded by checking if image exists
    let image_check = do {
        docker image inspect $"($base_image):($sha_tag)" | complete
    }
    
    if $image_check.exit_code != 0 {
        print $"($env.ALGA_COLOR_RED)Build failed - image not created($env.ALGA_COLOR_RESET)"
        error make { msg: "Docker build failed" }
    }
    
    print $"($env.ALGA_COLOR_GREEN)Successfully built with tags: ($tags_to_apply | str join ', ')($env.ALGA_COLOR_RESET)"
    
    if $push {
        # Push all tags
        for tag in $tags_to_apply {
            let full_image = $"($base_image):($tag)"
            print $"($env.ALGA_COLOR_YELLOW)Pushing: ($full_image)($env.ALGA_COLOR_RESET)"
            print $"($env.ALGA_COLOR_CYAN)Push output will be streamed to terminal...($env.ALGA_COLOR_RESET)"
            
            # Push the image - stream output directly
            docker push $full_image
            
            # Check if push succeeded by trying to pull the image info from registry
            let push_check = do {
                docker manifest inspect $full_image | complete
            }
            
            if $push_check.exit_code != 0 {
                print $"($env.ALGA_COLOR_RED)Push may have failed for ($full_image) - unable to verify image in registry($env.ALGA_COLOR_RESET)"
                print $"($env.ALGA_COLOR_YELLOW)Note: This could also mean the registry doesn't support manifest inspection($env.ALGA_COLOR_RESET)"
            } else {
                print $"($env.ALGA_COLOR_GREEN)Successfully pushed: ($full_image)($env.ALGA_COLOR_RESET)"
            }
        }
    }
}

# Build AI Web Docker image
export def build-ai-web [
    --tag: string = ""       # Docker tag to use (defaults to SHA)
    --push                   # Push to registry after building
    --use-latest             # Tag with both SHA and 'latest'
    --local                  # Build locally instead of in Kubernetes
    --cpu: string = "4"      # CPU cores to allocate for Kubernetes builds
    --memory: string = "4Gi" # Memory to allocate for Kubernetes builds
] {
    # If --local flag is NOT set, use Kubernetes build (default)
    if not $local {
        if $push and $use_latest {
            build-ai-web-k8s --tag $tag --push --use-latest --cpu $cpu --memory $memory
        } else if $push {
            build-ai-web-k8s --tag $tag --push --cpu $cpu --memory $memory
        } else if $use_latest {
            build-ai-web-k8s --tag $tag --use-latest --cpu $cpu --memory $memory
        } else {
            build-ai-web-k8s --tag $tag --cpu $cpu --memory $memory
        }
        return
    }
    
    # Local build logic
    print $"($env.ALGA_COLOR_CYAN)Building AI Web Docker image locally...($env.ALGA_COLOR_RESET)"
    
    let project_root = find-project-root
    cd $project_root
    
    # Determine image name
    let registry = "harbor.nineminds.com"
    let namespace = "nineminds"
    let image_name = "alga-ai-web"
    let base_image = $"($registry)/($namespace)/($image_name)"
    
    # Generate SHA tag
    let sha_tag = if ($tag | str length) > 0 {
        $tag
    } else {
        # Generate unique tag using git commit SHA only (consistent across calls)
        let git_sha = (git rev-parse --short HEAD | complete)
        
        if $git_sha.exit_code == 0 {
            let sha = ($git_sha.stdout | str trim)
            $sha
        } else {
            # Fallback if git is not available - use timestamp
            let timestamp = (date now | format date '%Y%m%d-%H%M%S')
            $"build-($timestamp)"
        }
    }
    
    # Build list of tags to apply
    let tags_to_apply = if $use_latest {
        # When --use-latest is specified, tag with both SHA and latest
        [$sha_tag, "latest"]
    } else {
        # Otherwise just use the single tag
        [$sha_tag]
    }
    
    # Build tag arguments for docker build
    let tag_args = ($tags_to_apply | each { |t| ["-t", $"($base_image):($t)"] } | flatten)
    
    print $"($env.ALGA_COLOR_YELLOW)Building with tags: ($tags_to_apply | str join ', ')($env.ALGA_COLOR_RESET)"
    print $"($env.ALGA_COLOR_CYAN)Build output will be streamed to terminal...($env.ALGA_COLOR_RESET)"
    
    # Build the image from the ai-automation/web directory
    cd ($project_root | path join "tools" "ai-automation" "web")
    docker build --platform linux/amd64 -f Dockerfile ...$tag_args .
    
    # Check if build succeeded by checking if image exists
    let image_check = do {
        docker image inspect $"($base_image):($sha_tag)" | complete
    }
    
    if $image_check.exit_code != 0 {
        print $"($env.ALGA_COLOR_RED)Build failed - image not created($env.ALGA_COLOR_RESET)"
        error make { msg: "Docker build failed" }
    }
    
    print $"($env.ALGA_COLOR_GREEN)Successfully built with tags: ($tags_to_apply | str join ', ')($env.ALGA_COLOR_RESET)"
    
    if $push {
        # Push all tags
        for tag in $tags_to_apply {
            let full_image = $"($base_image):($tag)"
            print $"($env.ALGA_COLOR_YELLOW)Pushing: ($full_image)($env.ALGA_COLOR_RESET)"
            print $"($env.ALGA_COLOR_CYAN)Push output will be streamed to terminal...($env.ALGA_COLOR_RESET)"
            
            # Push the image - stream output directly
            docker push $full_image
            
            # Check if push succeeded by trying to pull the image info from registry
            let push_check = do {
                docker manifest inspect $full_image | complete
            }
            
            if $push_check.exit_code != 0 {
                print $"($env.ALGA_COLOR_RED)Push may have failed for ($full_image) - unable to verify image in registry($env.ALGA_COLOR_RESET)"
                print $"($env.ALGA_COLOR_YELLOW)Note: This could also mean the registry doesn't support manifest inspection($env.ALGA_COLOR_RESET)"
            } else {
                print $"($env.ALGA_COLOR_GREEN)Successfully pushed: ($full_image)($env.ALGA_COLOR_RESET)"
            }
        }
    }
}

# Build AI Web Docker image using Kubernetes job
export def build-ai-web-k8s [
    --tag: string = ""       # Docker tag to use (defaults to SHA)
    --push                   # Push to registry after building
    --use-latest             # Tag with both SHA and 'latest'
    --namespace: string = "default"  # Kubernetes namespace to run the job in
    --cpu: string = "4"      # CPU cores to allocate
    --memory: string = "4Gi" # Memory to allocate
] {
    print $"($env.ALGA_COLOR_CYAN)Building AI Web Docker image using Kubernetes job...($env.ALGA_COLOR_RESET)"
    
    let project_root = find-project-root
    cd $project_root
    
    # Determine image name
    let registry = "harbor.nineminds.com"
    let namespace_img = "nineminds"
    let image_name = "alga-ai-web"
    let base_image = $"($registry)/($namespace_img)/($image_name)"
    
    # Generate SHA tag
    let sha_tag = if ($tag | str length) > 0 {
        $tag
    } else {
        # Generate unique tag using git commit SHA only (consistent across calls)
        let git_sha = (git rev-parse --short HEAD | complete)
        
        if $git_sha.exit_code == 0 {
            let sha = ($git_sha.stdout | str trim)
            $sha
        } else {
            # Fallback if git is not available - use timestamp
            let timestamp = (date now | format date '%Y%m%d-%H%M%S')
            $"build-($timestamp)"
        }
    }
    
    # Get current git branch/ref
    let git_ref = (git rev-parse HEAD | complete)
    let current_ref = if $git_ref.exit_code == 0 {
        ($git_ref.stdout | str trim)
    } else {
        "main"
    }
    
    # Build list of tags to apply
    let tags_to_apply = if $use_latest {
        # When --use-latest is specified, tag with both SHA and latest
        [$sha_tag, "latest"]
    } else {
        # Otherwise just use the single tag
        [$sha_tag]
    }
    
    # Generate unique job name
    let timestamp = (date now | format date '%Y%m%d-%H%M%S')
    let job_name = $"ai-web-build-($timestamp)"
    
    print $"($env.ALGA_COLOR_YELLOW)Building with tags: ($tags_to_apply | str join ', ')($env.ALGA_COLOR_RESET)"
    print $"($env.ALGA_COLOR_YELLOW)Using Kubernetes job: ($job_name)($env.ALGA_COLOR_RESET)"
    print $"($env.ALGA_COLOR_CYAN)Using existing harbor-credentials secret for registry authentication($env.ALGA_COLOR_RESET)"
    
    # Create values file for the Helm job
    let values_content = {
        buildJob: {
            name: $job_name,
            namespace: $namespace,
            type: "ai-web",
            timeout: 1800,
            ttl: 300,
            gitRepo: "https://github.com/nine-minds/alga-psa.git",
            gitRef: $current_ref,
            buildPath: "tools/ai-automation/web",
            dockerfile: "Dockerfile",
            context: ".",
            registry: $registry,
            push: $push,
            tags: ($tags_to_apply | each { |t| $"($base_image):($t)" }),
            resources: {
                cpu: $cpu,
                memory: $memory,
                cpuLimit: $cpu,
                memoryLimit: $memory
            }
        }
    }
    
    print $"($env.ALGA_COLOR_CYAN)Creating build job in Kubernetes...($env.ALGA_COLOR_RESET)"
    
    # Ensure harbor-credentials exists in the namespace
    let secret_check = do {
        kubectl get secret harbor-credentials -n $namespace | complete
    }
    
    if $secret_check.exit_code != 0 {
        print $"($env.ALGA_COLOR_YELLOW)Copying harbor-credentials to namespace ($namespace)...($env.ALGA_COLOR_RESET)"
        let copy_result = do {
            kubectl get secret harbor-credentials -n nineminds -o yaml | sed $"s/namespace: nineminds/namespace: ($namespace)/" | kubectl apply -f - | complete
        }
        
        if $copy_result.exit_code != 0 {
            print $"($env.ALGA_COLOR_RED)Failed to copy harbor-credentials to namespace($env.ALGA_COLOR_RESET)"
            error make { msg: "Harbor credentials not available in target namespace" }
        }
    }
    
    # Build docker tags arguments
    let docker_tags = ($tags_to_apply | each { |t| $"-t ($base_image):($t)" } | str join ' ')
    
    # Build push commands if needed
    let push_commands = if $push {
        let push_cmds = ($tags_to_apply | each { |t| $"docker push ($base_image):($t)" } | str join "\n")
        $"echo 'Pushing Docker images...'\n($push_cmds)"
    } else {
        ""
    }
    
    # Create the shell script content
    let build_script = '#!/bin/sh
set -e
echo "Starting build process..."

# Wait for Docker daemon to be ready
timeout=60
until docker info >/dev/null 2>&1; do
  if [ $timeout -le 0 ]; then
    echo "Docker daemon did not start in time"
    exit 1
  fi
  echo "Waiting for Docker daemon..."
  timeout=$((timeout - 5))
  sleep 5
done

echo "Docker daemon is ready"

# Configure Docker to use the registry from harbor-credentials secret
echo "Configuring Docker registry authentication..."
mkdir -p /root/.docker
cp /harbor-creds/.dockerconfigjson /root/.docker/config.json
echo "Docker registry authentication configured"

# Clone the repository
echo "Cloning repository..."
git clone https://github.com/nine-minds/alga-psa.git /workspace
cd /workspace

# Checkout the specified branch/commit
echo "Checking out ' + $current_ref + '..."
git checkout ' + $current_ref + '

# Navigate to the build directory
cd tools/ai-automation/web

# Build the Docker image
echo "Building Docker image..."
docker build --platform linux/amd64 -f Dockerfile ' + $docker_tags + ' .

# Push the images if requested
' + $push_commands + '

echo "Build completed successfully!"

# Signal the docker daemon to shut down
echo "Signaling Docker daemon to shut down..."
touch /tmp/build-complete'
    
    # Create job manifest
    let job_manifest = {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: {
            name: $job_name,
            namespace: $namespace,
            labels: {
                app: "alga-build-job",
                "build-type": "ai-web"
            }
        },
        spec: {
            activeDeadlineSeconds: 1800,
            ttlSecondsAfterFinished: 300,
            template: {
                metadata: {
                    labels: {
                        app: "alga-build-job",
                        "build-type": "ai-web"
                    }
                },
                spec: {
                    restartPolicy: "Never",
                    containers: [{
                        name: "build",
                        image: "docker:24-dind",
                        command: ["/bin/sh"],
                        args: ["-c", $build_script],
                        env: [{
                            name: "DOCKER_HOST",
                            value: "tcp://localhost:2375"
                        }],
                        resources: {
                            requests: {
                                memory: $memory,
                                cpu: $cpu
                            },
                            limits: {
                                memory: $memory,
                                cpu: $cpu
                            }
                        },
                        volumeMounts: [{
                            name: "workspace",
                            mountPath: "/workspace"
                        }, {
                            name: "harbor-creds",
                            mountPath: "/harbor-creds",
                            readOnly: true
                        }, {
                            name: "shared",
                            mountPath: "/tmp"
                        }]
                    }, {
                        name: "docker-daemon",
                        image: "docker:24-dind",
                        command: ["/bin/sh"],
                        args: ["-c", "dockerd-entrypoint.sh & while [ ! -f /tmp/build-complete ]; do sleep 5; done; echo 'Build complete signal received, shutting down...'; sleep 10"],
                        securityContext: {
                            privileged: true
                        },
                        env: [{
                            name: "DOCKER_TLS_CERTDIR",
                            value: ""
                        }],
                        resources: {
                            requests: {
                                memory: "1Gi",
                                cpu: "1"
                            },
                            limits: {
                                memory: "2Gi",
                                cpu: "2"
                            }
                        },
                        volumeMounts: [{
                            name: "docker-storage",
                            mountPath: "/var/lib/docker"
                        }, {
                            name: "shared",
                            mountPath: "/tmp"
                        }]
                    }],
                    volumes: [{
                        name: "workspace",
                        emptyDir: {}
                    }, {
                        name: "docker-storage",
                        emptyDir: {}
                    }, {
                        name: "shared",
                        emptyDir: {}
                    }, {
                        name: "harbor-creds",
                        secret: {
                            secretName: "harbor-credentials",
                            items: [{
                                key: ".dockerconfigjson",
                                path: ".dockerconfigjson"
                            }]
                        }
                    }]
                }
            }
        }
    }
    
    # Write job manifest to file
    let job_file = $"/tmp/build-job-($timestamp).yaml"
    $job_manifest | to yaml | save -f $job_file
    
    # Create the job
    let helm_result = do {
        kubectl apply -f $job_file -n $namespace | complete
    }
    
    if $helm_result.exit_code != 0 {
        print $"($env.ALGA_COLOR_RED)Failed to create build job($env.ALGA_COLOR_RESET)"
        rm -f $job_file
        error make { msg: "Failed to create Kubernetes job" }
    }
    
    print $"($env.ALGA_COLOR_GREEN)Build job created successfully($env.ALGA_COLOR_RESET)"
    print $"($env.ALGA_COLOR_CYAN)Monitoring job progress...($env.ALGA_COLOR_RESET)"
    
    # Monitor the job
    let start_time = (date now | format date '%s' | into int)
    let timeout_seconds = 1800  # 30 minutes
    
    loop {
        # Check job status
        let job_status = do {
            kubectl get job $job_name -n $namespace -o json | complete
        }
        
        if $job_status.exit_code != 0 {
            print $"($env.ALGA_COLOR_RED)Failed to get job status($env.ALGA_COLOR_RESET)"
            break
        }
        
        let status = ($job_status.stdout | from json)
        
        # Check if job completed
        if ("succeeded" in $status.status) and ($status.status.succeeded? | default 0) > 0 {
            print $"($env.ALGA_COLOR_GREEN)Build completed successfully!($env.ALGA_COLOR_RESET)"
            break
        }
        
        # Check if job failed
        if ("failed" in $status.status) and ($status.status.failed? | default 0) > 0 {
            print $"($env.ALGA_COLOR_RED)Build failed!($env.ALGA_COLOR_RESET)"
            
            # Get pod logs
            let pods = do {
                kubectl get pods -n $namespace -l job-name=$job_name -o json | complete
            }
            
            if $pods.exit_code == 0 {
                let pod_list = ($pods.stdout | from json)
                if ($pod_list.items | length) > 0 {
                    let pod_name = $pod_list.items.0.metadata.name
                    print $"($env.ALGA_COLOR_YELLOW)Fetching logs from pod: ($pod_name)($env.ALGA_COLOR_RESET)"
                    kubectl logs $pod_name -n $namespace -c build --tail=100
                }
            }
            
            # Clean up job
            kubectl delete job $job_name -n $namespace --ignore-not-found | complete
            rm -f $job_file
            error make { msg: "Build job failed" }
        }
        
        # Check timeout
        let current_time = (date now | format date '%s' | into int)
        let elapsed = ($current_time - $start_time)
        
        if $elapsed > $timeout_seconds {
            print $"($env.ALGA_COLOR_RED)Build timed out after ($elapsed) seconds($env.ALGA_COLOR_RESET)"
            kubectl delete job $job_name -n $namespace --ignore-not-found | complete
            rm -f $job_file
            error make { msg: "Build job timed out" }
        }
        
        # Get current pod status
        let pods = do {
            kubectl get pods -n $namespace -l job-name=$job_name --no-headers | complete
        }
        
        if $pods.exit_code == 0 and ($pods.stdout | str trim | str length) > 0 {
            print -n $"\r($env.ALGA_COLOR_CYAN)Job status: ($pods.stdout | str trim | split column -c '\\s+' | get column2.0)/Running - Elapsed: ($elapsed)s($env.ALGA_COLOR_RESET)"
        }
        
        sleep 5sec
    }
    
    # Stream logs from the completed job
    print $"\n($env.ALGA_COLOR_CYAN)Build logs:($env.ALGA_COLOR_RESET)"
    let pods = do {
        kubectl get pods -n $namespace -l job-name=$job_name -o json | complete
    }
    
    if $pods.exit_code == 0 {
        let pod_list = ($pods.stdout | from json)
        if ($pod_list.items | length) > 0 {
            let pod_name = $pod_list.items.0.metadata.name
            kubectl logs $pod_name -n $namespace -c build
        }
    }
    
    # Clean up
    print $"($env.ALGA_COLOR_CYAN)Cleaning up...($env.ALGA_COLOR_RESET)"
    kubectl delete job $job_name -n $namespace --ignore-not-found | complete
    rm -f $job_file
    
    print $"($env.ALGA_COLOR_GREEN)Build process completed!($env.ALGA_COLOR_RESET)"
    
    if $push {
        for tag in $tags_to_apply {
            print $"($env.ALGA_COLOR_GREEN)Image pushed: ($base_image):($tag)($env.ALGA_COLOR_RESET)"
        }
    }
}

# Build all AI Docker images (API and Web)
export def build-ai-all [
    --tag: string = ""       # Docker tag to use (defaults to SHA)
    --push                   # Push to registry after building
    --use-latest             # Tag with both SHA and 'latest'
] {
    print $"($env.ALGA_COLOR_CYAN)Building all AI Docker images...($env.ALGA_COLOR_RESET)"
    
    # Build AI API
    if $push and $use_latest {
        build-ai-api --tag $tag --push --use-latest
    } else if $push {
        build-ai-api --tag $tag --push
    } else if $use_latest {
        build-ai-api --tag $tag --use-latest
    } else {
        build-ai-api --tag $tag
    }
    
    # Build AI Web
    if $push and $use_latest {
        build-ai-web --tag $tag --push --use-latest
    } else if $push {
        build-ai-web --tag $tag --push
    } else if $use_latest {
        build-ai-web --tag $tag --use-latest
    } else {
        build-ai-web --tag $tag
    }
    
    print $"($env.ALGA_COLOR_GREEN)All AI images built successfully!($env.ALGA_COLOR_RESET)"
}