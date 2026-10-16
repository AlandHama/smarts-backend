import { createHash } from "node:crypto"

export function wordDashBoardHash(rulesVersion: string, dictionaryVersion: string, boardLetters: string) {
  return createHash("sha256").update(`${rulesVersion}:${dictionaryVersion}:${boardLetters}`).digest("hex")
}
