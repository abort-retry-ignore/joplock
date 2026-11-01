# Joplock public demo

`https://joplock.bazooda.com`: Joplock with example notes and a published login (**demo / demo**).
Everything is wiped and the example notes come back every 30 minutes.

## What runs where

| Piece | Where |
|---|---|
| Instance | one `t4g.small` (ARM, Amazon Linux 2023) in the sandbox account, region `ap-southeast-6` (Auckland), Elastic IP |
| DNS | `joplock.bazooda.com` A record in the `bazooda.com` zone (account with the `personal` profile) |
| Stack (`app/compose.yml`) | Caddy (HTTPS, automatic Let's Encrypt) → Joplock → Joplin Server → Postgres; only Caddy is published |
| Reset | `joplock-demo-reset.timer` at `:00` and `:30` UTC runs `app/reset.sh`: restore `golden.dump`, restart Joplin Server and Joplock (~7 s, a "resetting" page meanwhile) |
| Example notes | `scripts/seed-demo.mjs`, run by `app/build-golden.sh` on a fresh database at every deploy |

Rough cost: ~US$20/month (instance, Elastic IP, 20 GB disk).

## Why it is safe to publish

- **Joplock demo mode** (`JOPLOCK_DEMO_MODE`, `app/demoMode.js` in the repo): only `demo / demo` can sign in, and it maps
  to the real account whose password is a 40-character secret generated on the server. Changing the
  password, email, two-factor or session settings, AI (user-set provider URLs would let the server
  fetch arbitrary addresses) and sharing are refused by the server. Uploads are capped at 5 MB.
- **Joplin Server is not reachable**: no published port and no `/joplin` proxy, so its own login page,
  API and default `admin@localhost` account are out of reach (and that account is locked anyway).
- **Every reset restores the snapshot**, so nothing a visitor does lasts more than 30 minutes, including
  a password changed some other way (Joplock also puts it back at every start).
- **Host**: no IAM role, IMDSv2 with hop limit 1 (containers cannot reach instance metadata), encrypted
  disk, SSH only from `admin_cidrs`, daily security updates, `noindex` so visitor notes stay out of search.

Visitors share one account: they see each other's edits until the next reset. One account per visitor
would remove that; it is not built.

## Deploy / update

```bash
cd deploy/demo/terraform
cp terraform.tfvars.example terraform.tfvars   # set admin_cidrs to your IP (curl checkip.amazonaws.com)
terraform init && terraform apply              # instance, Elastic IP, security group, DNS record
cd .. && ./deploy.sh                            # copy the stack, pull images, build the golden DB, enable the timer
```

`deploy.sh` is also how to update: it pulls `ghcr.io/abort-retry-ignore/joplock:latest` (published by CI
on every push to `master`) and rebuilds the snapshot. Needs `~/.ssh/joplock-demo` (the key in
`ssh_public_key_path`).

## Operate

```bash
ssh -i ~/.ssh/joplock-demo ec2-user@$(terraform -chdir=terraform output -raw public_ip)
sudo /opt/joplock-demo/reset.sh                        # reset now
sudo journalctl -u joplock-demo-reset --since today    # reset log
systemctl list-timers joplock-demo-reset.timer         # next reset
cd /opt/joplock-demo && sudo docker compose logs -f joplock
```

Your IP changed? Update `admin_cidrs` in `terraform.tfvars` and `terraform apply` (only the security group changes).

## Remove

```bash
cd deploy/demo/terraform && terraform destroy
```
Deletes the instance (and the database with it), the Elastic IP, the security group, the key pair and
the DNS record. Terraform state is local (`terraform/terraform.tfstate`, git-ignored).
