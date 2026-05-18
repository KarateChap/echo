output "state_bucket_name" {
  value = aws_s3_bucket.state.bucket
}

output "state_lock_table_name" {
  value = aws_dynamodb_table.state_lock.name
}

output "aws_account_id" {
  value = data.aws_caller_identity.current.account_id
}

output "deploy_role_dev_arn" {
  value = aws_iam_role.deploy_dev.arn
}

output "github_oidc_provider_arn" {
  value = aws_iam_openid_connect_provider.github.arn
}
