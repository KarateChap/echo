variable "environment" {
  description = "dev | prod"
  type        = string
}

variable "bucket_name" {
  type = string
}

variable "domain_names" {
  description = "Fully-qualified domains served by the distribution. First entry is the primary (CNAME record will point here)."
  type        = list(string)
}

variable "price_class" {
  type    = string
  default = "PriceClass_100"
}
