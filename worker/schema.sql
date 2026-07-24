CREATE TABLE credits (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  balance INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE credit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
