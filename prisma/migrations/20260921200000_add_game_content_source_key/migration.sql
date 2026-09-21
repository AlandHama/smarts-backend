ALTER TABLE "GameContentItem" ADD COLUMN "sourceKey" VARCHAR(160);

CREATE INDEX "GameContentItem_gameDefinitionId_sourceKey_idx"
  ON "GameContentItem"("gameDefinitionId", "sourceKey");
