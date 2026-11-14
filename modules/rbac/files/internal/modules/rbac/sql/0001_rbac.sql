-- Roles per tenant (a single-tenant deployment uses one tenant). The built-in
-- roles come from config/app.bcl and are installed the first time a tenant is
-- seen; after that this table is authoritative and administrators edit it.
CREATE TABLE IF NOT EXISTS rbac_roles (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, permissions TEXT NOT NULL, inherits TEXT NOT NULL DEFAULT '[]',
  system INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (tenant_id, id)
);
-- Extra roles granted to an account on top of its base role.
CREATE TABLE IF NOT EXISTS rbac_members (
  tenant_id TEXT NOT NULL, account_id TEXT NOT NULL, role_id TEXT NOT NULL, granted_by TEXT NOT NULL DEFAULT '', granted_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, account_id, role_id)
);
CREATE TABLE IF NOT EXISTS rbac_meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
INSERT OR IGNORE INTO rbac_meta (k, v) VALUES ('rev', 0);
CREATE TABLE IF NOT EXISTS rbac_history (
  rev INTEGER PRIMARY KEY, snapshot TEXT NOT NULL, author TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', at TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS rbac_history_tenant ON rbac_history (tenant_id, rev);
-- Denied decisions only (allowed ones are high volume and carry no signal).
CREATE TABLE IF NOT EXISTS rbac_denials (
  id TEXT PRIMARY KEY, at TEXT NOT NULL, subject TEXT NOT NULL, action TEXT NOT NULL, resource TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
  tenant_id TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS rbac_denials_tenant ON rbac_denials (tenant_id, at);
