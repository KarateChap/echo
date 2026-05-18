resource "aws_acm_certificate" "site" {
  provider = aws.us_east_1

  domain_name               = var.domain_names[0]
  subject_alternative_names = length(var.domain_names) > 1 ? slice(var.domain_names, 1, length(var.domain_names)) : []
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# Blocks until ACM sees the validation CNAME in DNS and issues the cert.
# Since DNS is on Namecheap (not Route53), Terraform does not create the
# validation records — you add them manually. This resource just waits.
resource "aws_acm_certificate_validation" "site" {
  provider = aws.us_east_1

  certificate_arn = aws_acm_certificate.site.arn

  timeouts {
    create = "60m"
  }
}
