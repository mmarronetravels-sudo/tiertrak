-- Migration 004: Student Archive Feature
ALTER TABLE students 
ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS archived_by INTEGER REFERENCES users(id),
ADD COLUMN IF NOT EXISTS archived_reason VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_students_archived ON students(archived);
CREATE INDEX IF NOT EXISTS idx_students_tenant_archived ON students(tenant_id, archived);

UPDATE students SET archived = FALSE WHERE archived IS NULL;

SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'students' AND column_name IN ('archived', 'archived_at', 'archived_by', 'archived_reason');
