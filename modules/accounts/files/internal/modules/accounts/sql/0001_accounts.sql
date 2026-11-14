CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, role TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
  email_bidx TEXT NOT NULL DEFAULT '', phone_bidx TEXT NOT NULL DEFAULT '', contact_enc TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL DEFAULT '', totp_secret_enc TEXT NOT NULL DEFAULT '', totp_enabled INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_email ON accounts (tenant_id, email_bidx) WHERE email_bidx <> '';
CREATE UNIQUE INDEX IF NOT EXISTS accounts_phone ON accounts (tenant_id, phone_bidx) WHERE phone_bidx <> '';
CREATE TABLE IF NOT EXISTS otp_challenges (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, purpose TEXT NOT NULL, code_hash TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS auth_lockouts (
  tenant_id TEXT NOT NULL, subject_bidx TEXT NOT NULL, failed INTEGER NOT NULL DEFAULT 0, locked_until TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (tenant_id, subject_bidx)
);
