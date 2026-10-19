/** Stable public entrypoint kept separate so future generator versions can be
 * added without changing the match service contract. */
export { generateBombPathField } from "./bomb-path-engine"
export type { BombPathField, BombPathPoint } from "./bomb-path-engine"
