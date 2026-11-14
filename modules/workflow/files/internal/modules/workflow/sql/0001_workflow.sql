-- Workflow cases run by the BCL pipeline engine. The case document (personal
-- data, history, notes) is sealed per subject in body_enc; the plain columns
-- hold only what queues and tenant scoping need.
CREATE TABLE IF NOT EXISTS workflow_cases (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, pipeline TEXT NOT NULL, subject_id TEXT NOT NULL, number TEXT NOT NULL,
  stage TEXT NOT NULL, status TEXT NOT NULL, assignee TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL,
  body_enc TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  route TEXT NOT NULL DEFAULT '', bucket TEXT NOT NULL DEFAULT '', priority INTEGER NOT NULL DEFAULT 5, breached INTEGER NOT NULL DEFAULT 0, held INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS workflow_cases_queue ON workflow_cases (tenant_id, pipeline, status, stage, created_at);
CREATE INDEX IF NOT EXISTS workflow_cases_subject ON workflow_cases (subject_id, pipeline);
CREATE UNIQUE INDEX IF NOT EXISTS workflow_cases_number ON workflow_cases (pipeline, number);
CREATE INDEX IF NOT EXISTS workflow_cases_triage ON workflow_cases (tenant_id, pipeline, stage, priority, created_at);
CREATE TABLE IF NOT EXISTS workflow_sequences (pipeline TEXT PRIMARY KEY, last INTEGER NOT NULL);
-- Per-tenant tuning of a workflow's forms and stage timings. Every change is a
-- new revision, so it can be reviewed and rolled back.
CREATE TABLE IF NOT EXISTS workflow_overrides (
  tenant_id TEXT NOT NULL, pipeline TEXT NOT NULL, rev INTEGER NOT NULL, body TEXT NOT NULL,
  author TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, pipeline, rev)
);
-- Notifications planned from workflow events, delivered with retry, and people's
-- preferences.
CREATE TABLE IF NOT EXISTS workflow_notifications (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, channel TEXT NOT NULL, digest TEXT NOT NULL DEFAULT '',
  deliver_at INTEGER NOT NULL, doc TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
  leased_until INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS workflow_notifications_due ON workflow_notifications (status, deliver_at);
CREATE INDEX IF NOT EXISTS workflow_notifications_user ON workflow_notifications (tenant_id, user_id, status);
CREATE TABLE IF NOT EXISTS notify_prefs (
  tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, doc TEXT NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);
-- A staff member who takes routed work. Without a profile (or without skills) the
-- person is never assigned work automatically; they can still claim it.
CREATE TABLE IF NOT EXISTS staff_profiles (
  account_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, skills TEXT NOT NULL DEFAULT '[]', capacity INTEGER NOT NULL DEFAULT 0 CHECK (capacity >= 0),
  calendar TEXT NOT NULL DEFAULT '', org_units TEXT NOT NULL DEFAULT '[]', delegate_to TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS staff_away (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, tenant_id TEXT NOT NULL, from_day TEXT NOT NULL, until_day TEXT NOT NULL, reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS staff_away_account ON staff_away (account_id);
-- Published workflow definitions: every version of a definition's BCL source with
-- its signature, so a change is reviewable, reversible and tamper-evident.
CREATE TABLE IF NOT EXISTS workflow_definitions (
  name TEXT NOT NULL, version INTEGER NOT NULL, source TEXT NOT NULL, signature TEXT NOT NULL, author TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '', at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (name, version)
);
-- The in-app notification inbox.
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS notifications_account ON notifications (account_id, created_at);
