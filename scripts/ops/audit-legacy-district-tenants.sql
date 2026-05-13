-- One-time pre-flight audit for Migration 029.
--
-- Run via: `\i scripts/ops/audit-legacy-district-tenants.sql` on prod.
-- Operator-runnable. Read-only. No side effects.
--
-- Expected result: one or more legacy district rows; S68 P1 audit on
-- prod found 2: tenant #9 (Humble ISD Demo) and tenant #11 (Vandercook
-- Demo). M029 reconciles each.

SELECT id, name, type, district_id, subdomain, created_at
  FROM tenants
 WHERE type = 'district'
 ORDER BY id;
