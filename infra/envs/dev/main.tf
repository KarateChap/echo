data "aws_caller_identity" "current" {}

module "site" {
  source = "../../modules/static-site"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  environment  = local.environment
  bucket_name  = "echo-web-dev-${data.aws_caller_identity.current.account_id}"
  domain_names = ["dev.pay-echo.space"]
}
