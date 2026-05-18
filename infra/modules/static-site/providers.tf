terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"

      configuration_aliases = [aws.us_east_1]
    }
  }
}
