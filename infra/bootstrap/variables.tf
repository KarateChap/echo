variable "aws_region" {
  type    = string
  default = "ap-southeast-1"
}

variable "owner_email" {
  type    = string
  default = "gabrielmarianoofficial@gmail.com"
}

variable "github_repo" {
  description = "GitHub repo slug in owner/name form."
  type        = string
  default     = "KarateChap/echo"
}

variable "bucket_name_prefix" {
  description = "Used to scope deploy role permissions."
  type        = string
  default     = "echo-web"
}
