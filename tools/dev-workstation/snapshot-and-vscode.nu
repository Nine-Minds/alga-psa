#!/usr/bin/env nu

let here = pwd
# 1. Build timestamp and paths
let ts      = (date now | format date "%Y%m%d%H%M%S")
let src     = $"($env.HOME)/alga-psa"
let snapdir = $"($env.HOME)/snapshots"
let target  = ($snapdir | path join $"alga-psa-snap-($ts)")

print $"Target: ($target)"
print $"Src: ($src)"

(mkdir $target)

# 2. Create the Btrfs snapshot
btrfs subvolume snapshot $src $target
print $"✔ Snapshot created at: ($target)"

# 3. Launch code-server and capture its container ID
let cid = (
  sudo docker run -d
    --name $"code-server-($ts)"
    --rm
    -p 8443        # ask Docker to pick a random host port
    -v $"($target):/home/coder/project"
    dev-latest
    --auth none
    --disable-telemetry
    --bind-addr 0.0.0.0:8443
)

# Print the raw container ID
print $"🚀 Started container: ($cid)"

# 4. Query Docker for the host port mapped to container’s 8443
let mapping = (sudo docker port $cid 8443)

# mapping will be like "0.0.0.0:49153" — split on ":" and take the last piece
let host_port = ($mapping | split column ":" | select column2 | first)

let ip = ip -4 addr show dev tailscale0
  | awk '/inet /{print $2}'
  | cut -d/ -f1

print $"🔌 VS Code is available at http://($ip):($host_port.column2)"