locals {
  environment = "dev"
  tags = {
    Project     = "echo"
    Component   = "web"
    Environment = local.environment
    ManagedBy   = "terraform"
    CostCenter  = "echo"
    Owner       = "gabrielmarianoofficial@gmail.com"
  }
}

provider "aws" {
  region = "ap-southeast-1"
  default_tags {
    tags = local.tags
  }
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = local.tags
  }
}
