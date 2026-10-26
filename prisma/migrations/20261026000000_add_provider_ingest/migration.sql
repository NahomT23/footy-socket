-- Adds provider ingestion columns:
--   provider_key  which source authored the row ("sim" = built-in simulator)
--   external_id   the provider's stable fixture id (null for sim rows)
--   competition   display league/competition name
-- Rows are deduped per (provider, external id); multiple NULLs (sim rows) are
-- allowed because PostgreSQL unique treats NULLs as distinct.
ALTER TABLE "matches" ADD COLUMN "provider_key" TEXT NOT NULL DEFAULT 'sim';
ALTER TABLE "matches" ADD COLUMN "external_id" TEXT;
ALTER TABLE "matches" ADD COLUMN "competition" TEXT;

-- Provider ingestion is idempotent per (provider, external fixture id).
CREATE UNIQUE INDEX "matches_provider_key_external_id_key" ON "matches"("provider_key", "external_id");
