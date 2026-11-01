#!/usr/bin/env bash
# Installs or updates the demo on the host (run as root by deploy.sh; safe to re-run).
#   install.sh <hostname>
# Secrets are generated here once and kept in .env (mode 600); they never leave the machine.
set -euo pipefail
cd "$(dirname "$0")"
host=${1:?usage: install.sh <hostname>}

if [ ! -f .env ]; then
	gen() { openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | head -c 40; }
	umask 077
	{
		echo "DEMO_HOSTNAME=$host"
		echo "POSTGRES_PASSWORD=$(gen)"
		echo "DEMO_ACCOUNT_PASSWORD=$(gen)"
	} > .env
	echo "install: generated .env"
fi
sed -i "s/^DEMO_HOSTNAME=.*/DEMO_HOSTNAME=$host/" .env
chmod 600 .env
chmod 755 build-golden.sh reset.sh

. ./lib.sh
dc pull --quiet
docker pull --quiet node:20-alpine >/dev/null
dc up -d --remove-orphans
./build-golden.sh

install -m 644 systemd/joplock-demo-reset.service systemd/joplock-demo-reset.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now joplock-demo-reset.timer
systemctl list-timers joplock-demo-reset.timer --no-pager | head -3
echo "install: done"
