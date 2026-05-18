provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "echo"
      Component   = "web"
      Environment = "shared"
      ManagedBy   = "terraform"
      CostCenter  = "echo"
      Owner       = var.owner_email
    }
  }
}
