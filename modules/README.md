# Opt-in modules

Features extracted from production apps (first from IDSetu) that any project
generated from this template can add:

```sh
fh-init -list-modules
fh-init -module example.com/acme/orders -dir orders -with accounts,rbac,workflow,billing
```

`-with` takes a comma-separated list. Required modules (`requires` in
`module.json`) are added automatically and ordered dependencies-first. Each
module also brings its frontend views when `lithe-boilerplate` has them
(`modules/<name>/` there), so the sidebar shows exactly what was chosen.

| Module | Needs | What it adds |
|---|---|---|
| `settings` | – | **`config/app.bcl`**: tenancy mode, roles & permissions, identity datasources, auth policy, key backend. `GET /auth/config` for the sign-in screen. |
| `audit` | – | Append-only, hash-chained audit log; `GET /api/audit`, `GET /api/audit/verify` (`audit:read`). |
| `vault` | settings | Per-subject envelope encryption, AAD-bound ciphertexts, blind indexes, crypto-shredding; encrypted-blob object store. Key from `APP_VAULT_KEY`. |
| `vault-secretr` | vault | KMS backend whose keys live in an encrypted [secretr](https://github.com/oarkflow/secretr) store (`vault { backend "secretr" }`). Needs access to that private module. |
| `accounts` | settings, audit, vault | Login against the BCL datasources (builtin table, static users, or your own SQL user table); argon2id/bcrypt, lockout, TOTP, OTP-verified self-registration, account admin API. |
| `rbac` | settings, audit | Editable, tenant-aware roles seeded from BCL; history & rollback, anti-escalation, denial log; becomes the authorizer for every module. |
| `workflow` | settings, audit, vault | BCL-defined multi-stage workflows on the `ref` pipeline engine (forms, stages, roles, routing, SLAs, notifications), signed versioned definitions, per-tenant form settings. Sample `request` workflow included. |
| `billing` | settings, audit | Prepaid usage ledger (idempotent charges/refunds), rate cards, volume tiers, meters, monthly invoices, CSV statements, low-balance alerts, optional gateway top-ups. |

## Configuration: `config/app.bcl`

One file, validated at startup (`bcl validate config/app.bcl`), covers:

```bcl
tenancy { mode "single" default "default" }     # single | multi

role "admin"  { title "Administrator" permissions ["*"] staff true }
role "editor" { permissions ["notes:read", "notes:write"] }
role "lead"   { inherits ["editor"] permissions ["notes:approve"] }

registration { enabled false default_role "viewer" verify "email" }

datasource "local"     { kind "builtin" }                       # accounts table
datasource "bootstrap" { kind "static" user "admin" { password_env "APP_LOGIN_PASSWORD" roles ["admin"] } }
datasource "legacy"    { kind "sql" hash "bcrypt"               # your own user table
  lookup "SELECT uid, email, pw_hash, role, active FROM users WHERE email = ?"
  columns { id "uid" password "pw_hash" roles "role" status "active" } }

auth { sources ["bootstrap", "local", "legacy"]                 # tried in this order
       lockout { max_failures 5 lock_minutes 15 }
       mfa { totp "optional" } }                                # off | optional | required

vault { backend "env" }                                         # env | secretr
```

* **Tenancy.** `single` ignores any tenant in requests and uses `tenancy.default`.
  `multi` isolates accounts, roles, cases and billing per tenant; login names the tenant.
* **Roles.** Permissions are `resource:action` or `*` (no partial wildcards). With
  `rbac` enabled the BCL roles are only *defaults*: they are installed per tenant the
  first time it is seen and then edited in the database/UI (history + rollback).
  Without `rbac` they are evaluated directly.
* **Datasources.** Lockout, MFA and audit apply no matter which source holds the
  account. `sql` sources need no code: your `lookup` query returns one row and
  `columns` map it. Only SQLite connections are compiled in; add a driver import for others.

## Permissions

Declared by each module and reported to the UI by `GET /api/permissions`.

| Permission | Module | Gates |
|---|---|---|
| `audit:read` | audit | audit log & verification |
| `accounts:read` / `accounts:write` | accounts | list / create / change accounts |
| `rbac:manage` | rbac | roles, grants, history, denials |
| `workflow:apply` / `work` / `approve` / `manage` | workflow | own case / queue & cases / approval actions / definitions & form settings |
| `billing:read` / `pay` / `manage` | billing | own balance & invoices / buy credit / any customer, rates, tiers |

## Anatomy

```
modules/<name>/
  module.json     name, description, requires, package, env, gomod
  files/          mirrors the generated project; *.tmpl is rendered
                  (__FH_MODULE__ replaced, .tmpl stripped, .go gofmt'd)
```

At runtime a module implements `modules.Module` (`internal/modules`): it returns
embedded SQL migrations (tracked per module in `module_migrations`) and registers
routes on `d.API` and services with `d.Provide`. Later modules read them with
`modules.Service[T](d, "name")`; optional integrations use `d.Lookup`. Protect a
route with `d.Require("resource:action")`. `fh-init` writes
`internal/modules/enabled/enabled.go` from the chosen set.

## Writing a module

1. `modules/<name>/module.json` plus `files/internal/modules/<name>/`.
2. Export `Module() modules.Module` from the package named in `module.json`; embed `sql/*.sql`.
3. Declare permissions with `d.DeclarePermissions(...)`.
4. Keep tests in the module (`*_test.go.tmpl`) so every generated project runs them.
5. Never import another module's package except through `requires` and the service registry.
6. If it has screens, add `modules/<name>/` to `lithe-boilerplate` (see its README).

## Known limits

* `/api/*` is only reachable through the encrypted browser transport, so the HTTP
  layer of the modules is exercised by the unit tests of their services plus a boot
  test; there is no curl-level test of `/api` routes.
* `vault-secretr` depends on a `secretr` revision newer than its latest tag
  (`storage.Config.DisableDeviceBinding`); `module.json` pins that commit. Tag it
  and update the pin when convenient.
* `workflow` leaves staff routing (`Service.Directory`) unset, so work is claimed
  from the queue rather than auto-assigned; implement `Directory`/skills on top of
  your own staff table. Document uploads inside forms are not wired.
