# One small instance running the whole demo with docker compose (deploy/demo/app), an Elastic IP,
# and an A record. Hardening: no IAM role, IMDSv2 only with a hop limit of 1 (containers cannot reach
# the instance metadata service), encrypted disk, SSH only from admin_cidrs, CPU credits capped.

data "aws_ssm_parameter" "al2023_arm64" {
  provider = aws.sandbox
  name     = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

data "aws_vpc" "default" {
  provider = aws.sandbox
  default  = true
}

data "aws_subnets" "default" {
  provider = aws.sandbox
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
  filter {
    name   = "default-for-az"
    values = ["true"]
  }
}

resource "aws_key_pair" "demo" {
  provider   = aws.sandbox
  key_name   = "joplock-demo"
  public_key = file(pathexpand(var.ssh_public_key_path))
}

resource "aws_security_group" "demo" {
  provider    = aws.sandbox
  name        = "joplock-demo"
  description = "Joplock demo: HTTP/HTTPS from anywhere, SSH from admin only"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description      = "HTTP (redirects to HTTPS, ACME challenges)"
    from_port        = 80
    to_port          = 80
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }
  ingress {
    description      = "HTTPS"
    from_port        = 443
    to_port          = 443
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }
  ingress {
    description      = "HTTP/3"
    from_port        = 443
    to_port          = 443
    protocol         = "udp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }
  ingress {
    description = "SSH from admin addresses only"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.admin_cidrs
  }
  egress {
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }
}

resource "aws_instance" "demo" {
  provider                    = aws.sandbox
  ami                         = data.aws_ssm_parameter.al2023_arm64.value
  instance_type               = var.instance_type
  subnet_id                   = sort(data.aws_subnets.default.ids)[0]
  vpc_security_group_ids      = [aws_security_group.demo.id]
  key_name                    = aws_key_pair.demo.key_name
  user_data                   = file("${path.module}/user_data.sh")
  user_data_replace_on_change = true

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_size           = 20
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = true
  }

  credit_specification {
    cpu_credits = "standard"
  }

  tags = { Name = "joplock-demo" }

  lifecycle {
    ignore_changes = [ami] # a new AMI must not replace the running demo; rebuild deliberately
  }
}

resource "aws_eip" "demo" {
  provider = aws.sandbox
  domain   = "vpc"
  tags     = { Name = "joplock-demo" }
}

resource "aws_eip_association" "demo" {
  provider      = aws.sandbox
  instance_id   = aws_instance.demo.id
  allocation_id = aws_eip.demo.id
}

data "aws_route53_zone" "zone" {
  provider     = aws.dns
  name         = var.zone_name
  private_zone = false
}

resource "aws_route53_record" "demo" {
  provider = aws.dns
  zone_id  = data.aws_route53_zone.zone.zone_id
  name     = "${var.hostname}.${var.zone_name}"
  type     = "A"
  ttl      = 300
  records  = [aws_eip.demo.public_ip]
}
