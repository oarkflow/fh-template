-- Prepaid usage billing. Money is an integer count of the currency's minor unit.
CREATE TABLE IF NOT EXISTS billing_accounts (
  customer_id TEXT NOT NULL, currency TEXT NOT NULL, balance_minor INTEGER NOT NULL DEFAULT 0,
  credit_limit_minor INTEGER NOT NULL DEFAULT 0 CHECK (credit_limit_minor >= 0),
  low_balance_minor INTEGER NOT NULL DEFAULT 0 CHECK (low_balance_minor >= 0), low_notified INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (customer_id, currency)
);
CREATE TABLE IF NOT EXISTS billing_ledger (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, meter_id TEXT NOT NULL DEFAULT '', currency TEXT NOT NULL,
  kind TEXT NOT NULL, amount_minor INTEGER NOT NULL, balance_after INTEGER NOT NULL, ref TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS billing_ledger_customer ON billing_ledger (customer_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS billing_ledger_ref ON billing_ledger (customer_id, kind, ref) WHERE ref <> '';
-- What one unit of usage costs: a plan's price per currency, volume discounts,
-- and meters (a named source of usage with its own price).
CREATE TABLE IF NOT EXISTS rate_cards (
  tenant_id TEXT NOT NULL, plan TEXT NOT NULL, currency TEXT NOT NULL, price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
  PRIMARY KEY (tenant_id, plan, currency)
);
CREATE TABLE IF NOT EXISTS volume_tiers (
  tenant_id TEXT NOT NULL, plan TEXT NOT NULL, currency TEXT NOT NULL, from_units INTEGER NOT NULL CHECK (from_units > 0),
  discount_bps INTEGER NOT NULL CHECK (discount_bps BETWEEN 1 AND 9500),
  PRIMARY KEY (tenant_id, plan, currency, from_units)
);
CREATE TABLE IF NOT EXISTS meters (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, name TEXT NOT NULL, currency TEXT NOT NULL,
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0), status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS meters_customer ON meters (customer_id, status);
-- Online top-ups through a payment gateway.
CREATE TABLE IF NOT EXISTS pay_orders (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL, account_id TEXT NOT NULL, provider TEXT NOT NULL,
  currency TEXT NOT NULL, units INTEGER NOT NULL CHECK (units > 0), unit_minor INTEGER NOT NULL, amount_minor INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', claimed_at TEXT NOT NULL DEFAULT '', paid_at TEXT NOT NULL DEFAULT '',
  gateway_txn TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pay_orders_customer ON pay_orders (customer_id, created_at);
-- Low-balance and payment notices land in the same inbox the workflow module uses.
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS notifications_account ON notifications (account_id, created_at);
