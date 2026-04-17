-- Migration 018: Per-tenant plan template overrides
--
-- Lets each tenant customize the plan_template attached to a shared/bank
-- intervention (intervention_templates rows with tenant_id IS NULL) without
-- mutating the global row. Existing tenant-owned templates continue to store
-- their plan_template directly on intervention_templates.
--
-- This migration is additive. It does not modify existing rows or columns.
-- Rollback: DROP TABLE tenant_plan_template_overrides;

CREATE TABLE IF NOT EXISTS tenant_plan_template_overrides (
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    template_id INTEGER NOT NULL REFERENCES intervention_templates(id) ON DELETE CASCADE,
    plan_template JSONB,
    has_plan_template BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by INTEGER REFERENCES users(id),
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_plan_template_overrides_tenant_id
    ON tenant_plan_template_overrides(tenant_id);
