output "bucket_name" {
  value = module.site.bucket_name
}

output "cloudfront_distribution_id" {
  value = module.site.cloudfront_distribution_id
}

output "cloudfront_domain_name" {
  value = module.site.cloudfront_domain_name
}

output "acm_validation_records" {
  value = module.site.acm_validation_records
}
