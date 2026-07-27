-- Supports scanRateExceeded's per-user, per-reason, time-windowed count.
CREATE INDEX IF NOT EXISTS idx_credit_log_user_reason_time
  ON credit_log(user_id, reason, created_at);
