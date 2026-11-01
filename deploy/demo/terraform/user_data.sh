#!/bin/bash
# First boot of the demo instance (Amazon Linux 2023, ARM): Docker + compose plugin, automatic
# security updates, a little swap, and the app directory. deploy.sh does the rest over SSH.
set -euxo pipefail

dnf -y install docker rsync dnf-automatic
systemctl enable --now docker
usermod -aG docker ec2-user

mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-aarch64 \
	-o /usr/local/lib/docker/cli-plugins/docker-compose
chmod 755 /usr/local/lib/docker/cli-plugins/docker-compose

# install security updates daily, without rebooting
sed -i 's/^upgrade_type.*/upgrade_type = security/; s/^apply_updates.*/apply_updates = yes/' /etc/dnf/automatic.conf
systemctl enable --now dnf-automatic.timer

# 2 GB of RAM runs the stack; 1 GB of swap absorbs peaks (golden builds, image pulls)
if [ ! -f /swapfile ]; then
	fallocate -l 1G /swapfile
	chmod 600 /swapfile
	mkswap /swapfile
	swapon /swapfile
	echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

install -d -o ec2-user -g ec2-user /opt/joplock-demo
