#!/usr/bin/env bash
# Deploys or updates the demo on the instance made by terraform/ (see README.md). Safe to re-run:
# it pulls the current images, rebuilds the golden database and (re)installs the reset timer.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
ip=$(terraform -chdir="$here/terraform" output -raw public_ip)
host=$(terraform -chdir="$here/terraform" output -raw hostname)
key=${SSH_KEY:-$HOME/.ssh/joplock-demo}
ssh_opts=(-i "$key" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)
target="ec2-user@$ip"

echo "deploy: waiting for $ip to finish its first boot"
until ssh "${ssh_opts[@]}" "$target" 'sudo cloud-init status --wait >/dev/null 2>&1; test -x /usr/local/lib/docker/cli-plugins/docker-compose' 2>/dev/null; do sleep 10; done

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cp -r "$here/app/." "$stage/"
mkdir -p "$stage/seed/lib"
cp "$repo/scripts/seed-demo.mjs" "$stage/seed/"
cp "$repo/scripts/lib/seed-client.mjs" "$repo/scripts/lib/seed-content.mjs" "$repo/scripts/lib/seed-vault.mjs" "$stage/seed/lib/"

echo "deploy: copying the stack to /opt/joplock-demo"
rsync -az --delete --exclude .env --exclude golden.dump --exclude compose.override.yml \
	-e "ssh ${ssh_opts[*]}" "$stage/" "$target:/opt/joplock-demo/"

echo "deploy: installing (pull images, build the golden database, enable the reset timer)"
ssh "${ssh_opts[@]}" "$target" "sudo /opt/joplock-demo/install.sh $host"
echo "deploy: https://$host"
