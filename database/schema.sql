CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('client', 'psychiatrist')),
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'pending', 'rejected')),
  client_id TEXT UNIQUE,
  professional_name TEXT,
  license_number TEXT,
  license_file TEXT,
  verification_consent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS client_links (
  client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  psychiatrist_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consented_at TEXT NOT NULL,
  UNIQUE(client_id, psychiatrist_id)
);

CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  overall_state TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'Connected system',
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  psychiatrist_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scheduled_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  psychiatrist_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  sent_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clinical_notes (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  psychiatrist_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_results_client_date ON results(client_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_journal_client_date ON journal_entries(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_appointments_pair_date
  ON appointments(client_id, psychiatrist_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_messages_pair_date
  ON messages(client_id, psychiatrist_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_notes_pair_date
  ON clinical_notes(client_id, psychiatrist_id, created_at);
