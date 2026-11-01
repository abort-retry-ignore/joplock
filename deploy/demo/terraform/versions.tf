terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

# The demo runs in the sandbox account; the DNS record lives in the account that hosts the zone.
provider "aws" {
  alias                  = "sandbox"
  profile                = var.sandbox_profile
  region                 = var.region
  skip_region_validation = true # Auckland (ap-southeast-6) is newer than some provider releases
  default_tags {
    tags = { Project = "joplock-demo", ManagedBy = "terraform" }
  }
}

provider "aws" {
  alias   = "dns"
  profile = var.dns_profile
  region  = "us-east-1" # Route 53 is global
}
