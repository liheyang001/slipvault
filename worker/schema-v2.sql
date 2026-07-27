-- Idempotency key for RevenueCat webhook deliveries. Partial unique index so
-- the existing rows (event_id NULL) don't collide with each other.
ALTER TABLE credit_log ADD COLUMN event_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_log_event
  ON credit_log(event_id) WHERE event_id IS NOT NULL;

-- Signup origin, for capping the free-credit grant per IP.
CREATE TABLE IF NOT EXISTS signup_ips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signup_ips_ip_time ON signup_ips(ip, created_at);
