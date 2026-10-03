terraform {
  required_version = ">= 1.7, < 2.0"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

# CLOUDFLARE_API_TOKEN is injected by op run; never store it in state or tfvars.
provider "cloudflare" {}

resource "cloudflare_d1_database" "app" {
  account_id = var.cloudflare_account_id
  name       = local.name
  lifecycle { prevent_destroy = true }
}

resource "cloudflare_r2_bucket" "staging" {
  account_id = var.cloudflare_account_id
  name       = "${local.name}-staging"
  location   = "weur"
  lifecycle { prevent_destroy = true }
}

resource "cloudflare_r2_managed_domain" "private" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.staging.name
  enabled     = false
}

resource "cloudflare_r2_bucket_cors" "staging" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.staging.name
  rules = [{
    id = "direct-browser-upload"
    allowed = {
      origins = [var.app_origin]
      methods = ["PUT"]
      headers = ["content-type", "content-length", "x-amz-content-sha256", "x-amz-date"]
    }
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }]
}

resource "cloudflare_queue" "publication" {
  account_id = var.cloudflare_account_id
  queue_name = "${local.name}-publication"
}

resource "cloudflare_queue" "dead_letter" {
  account_id = var.cloudflare_account_id
  queue_name = "${local.name}-dead-letter"
}

# Terraform bootstraps a maintenance response. Wrangler owns code, assets,
# bindings, secrets, consumers, custom domains and schedules after that.
resource "cloudflare_workers_script" "app" {
  account_id          = var.cloudflare_account_id
  script_name         = local.name
  main_module         = "index.js"
  compatibility_date  = "2026-08-01"
  compatibility_flags = ["nodejs_compat"]
  content             = "export default { fetch() { return new Response('Deployment pending', {status: 503}); } };"
  bindings = [
    { name = "DB", type = "d1", id = cloudflare_d1_database.app.id },
    { name = "STAGING_BUCKET", type = "r2_bucket", bucket_name = cloudflare_r2_bucket.staging.name },
    { name = "PUBLICATION_QUEUE", type = "queue", queue_name = cloudflare_queue.publication.queue_name }
  ]
  lifecycle {
    prevent_destroy = true
    ignore_changes  = all
  }
}
