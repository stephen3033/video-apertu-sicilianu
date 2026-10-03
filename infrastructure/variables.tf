variable "cloudflare_account_id" {
  type = string
  validation {
    condition     = can(regex("^[a-f0-9]{32}$", var.cloudflare_account_id)) && var.cloudflare_account_id != "00000000000000000000000000000000"
    error_message = "Supply the real 32-character Cloudflare account ID."
  }
}
variable "environment" {
  type = string
  validation {
    condition     = contains(["preview", "production"], var.environment)
    error_message = "Use preview or production with separate Terraform state."
  }
}
variable "app_name" {
  type    = string
  default = "video-apertu-sicilianu"
}
variable "app_origin" {
  type = string
  validation {
    condition     = can(regex("^https://[a-z0-9.-]+$", var.app_origin)) && !can(regex("localhost|127\\.0\\.0\\.1|example\\.|placeholder|\\*", var.app_origin))
    error_message = "Use one real HTTPS application origin without a path, wildcard or local host."
  }
}
variable "email_from" {
  type        = string
  description = "Email address at a Resend-verified sender domain."
  validation {
    condition     = can(regex("^[^@ ]+@[^@ ]+\\.[^@ ]+$", var.email_from)) && !can(regex("example\\.|placeholder", var.email_from))
    error_message = "Supply a real sender address, verified in Resend."
  }
}
locals {
  name = "${var.app_name}-${var.environment}"
}
