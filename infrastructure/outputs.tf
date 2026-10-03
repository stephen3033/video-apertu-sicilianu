output "deployment" {
  value = {
    environment       = var.environment
    account_id        = var.cloudflare_account_id
    worker_name       = cloudflare_workers_script.app.script_name
    database_id       = cloudflare_d1_database.app.id
    database_name     = cloudflare_d1_database.app.name
    bucket_name       = cloudflare_r2_bucket.staging.name
    publication_queue = cloudflare_queue.publication.queue_name
    dead_letter_queue = cloudflare_queue.dead_letter.queue_name
    app_origin        = var.app_origin
    email_from        = var.email_from
  }
}
