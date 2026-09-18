CREATE TABLE "PlayerCognitiveStats" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "calculation" INTEGER NOT NULL DEFAULT 50,
    "speed" INTEGER NOT NULL DEFAULT 50,
    "accuracy" INTEGER NOT NULL DEFAULT 50,
    "judgement" INTEGER NOT NULL DEFAULT 50,
    "observation" INTEGER NOT NULL DEFAULT 50,
    "memory" INTEGER NOT NULL DEFAULT 50,
    "matchesEvaluated" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerCognitiveStats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlayerCognitiveStats_userId_key" ON "PlayerCognitiveStats"("userId");
CREATE INDEX "PlayerCognitiveStats_accuracy_idx" ON "PlayerCognitiveStats"("accuracy");

ALTER TABLE "PlayerCognitiveStats" ADD CONSTRAINT "PlayerCognitiveStats_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
