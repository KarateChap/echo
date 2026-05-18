terraform {
  backend "s3" {
    bucket         = "echo-tf-state-597088041197"
    key            = "echo-web/dev/terraform.tfstate"
    region         = "ap-southeast-1"
    dynamodb_table = "echo-tf-state-lock"
    encrypt        = true
  }
}
