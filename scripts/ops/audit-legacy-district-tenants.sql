-- One-time pre-flight audit for Migration 029.
--
-- Run via: `\i scripts/ops/audit-legacy-district-tenants.sql` on prod.
-- Operator-runnable. Read-only. No side effects.
--
-- Expected result (per S67 close entry): exactly one row, tenant #9
-- (Humble ISD Demo). Any other rows must be reconciled before M029.

SELECT id, name, type, district_id, subdomain, created_at
  FROM tenants
 WHERE type = 'district'
 ORDER BY id;
