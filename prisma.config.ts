import { defineConfig } from "prisma/config"

// Prisma 7 takes the connection URL from here rather than from schema.prisma.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Read directly instead of through prisma/config's env(), which throws when the
  // variable is missing - that would break `prisma generate` during a build with
  // no database attached.
  datasource: { url: process.env.DATABASE_URL ?? "" },
})
