variable "sandbox_profile" {
  description = "AWS CLI profile for the account that runs the demo"
  type        = string
  default     = "sandbox"
}

variable "region" {
  description = "Region for the demo instance"
  type        = string
  default     = "ap-southeast-6"
}

variable "dns_profile" {
  description = "AWS CLI profile for the account that hosts the DNS zone"
  type        = string
  default     = "personal"
}

variable "zone_name" {
  description = "Public Route 53 zone"
  type        = string
  default     = "bazooda.com"
}

variable "hostname" {
  description = "Name of the demo inside the zone"
  type        = string
  default     = "joplock"
}

variable "instance_type" {
  description = "ARM (Graviton) instance; 2 GB runs Postgres, Joplin Server, Joplock and Caddy"
  type        = string
  default     = "t4g.small"
}

variable "ssh_public_key_path" {
  description = "Public key for SSH as ec2-user (deploy.sh uses the matching private key)"
  type        = string
  default     = "~/.ssh/joplock-demo.pub"
}

variable "admin_cidrs" {
  description = "Addresses allowed to SSH in (your IP as x.x.x.x/32). Nothing else can reach port 22."
  type        = list(string)
}
