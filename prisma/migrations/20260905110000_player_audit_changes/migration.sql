-- Enrich existing player audit events with field-level before/after values.
-- IF NOT EXISTS keeps this safe when the initial audit migration was edited or
-- applied by an earlier deployment.
ALTER TABLE "PlayerAuditEvent" ADD COLUMN IF NOT EXISTS "changes" JSONB;
