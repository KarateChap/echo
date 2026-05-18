output "bucket_name" {
  value = aws_s3_bucket.site.bucket
}

output "bucket_arn" {
  value = aws_s3_bucket.site.arn
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.site.id
}

output "cloudfront_domain_name" {
  description = "Point your Namecheap CNAME records at this hostname."
  value       = aws_cloudfront_distribution.site.domain_name
}

output "acm_validation_records" {
  description = "Add these as CNAME records in Namecheap to validate the ACM certificate."
  value = [
    for dvo in aws_acm_certificate.site.domain_validation_options : {
      domain = dvo.domain_name
      name   = dvo.resource_record_name
      value  = dvo.resource_record_value
    }
  ]
}
