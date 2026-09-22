export type AvatarFramePreset = {
  key: string
  name: string
  description: string
  primary: string
  secondary: string
  accent: string
  animation: "none" | "pulse" | "spin" | "shimmer" | "orbit" | "sparkle"
}

/** Server-owned frame vocabulary shared by the admin preview and mobile renderer. */
export const AVATAR_FRAME_PRESETS: readonly AvatarFramePreset[] = [
  { key: "aurora", name: "Aurora Ring", description: "A soft northern-light pulse.", primary: "#8b5cf6", secondary: "#22d3ee", accent: "#f5d06f", animation: "pulse" },
  { key: "solar-flare", name: "Solar Flare", description: "Warm gold light with a moving flare.", primary: "#f97316", secondary: "#facc15", accent: "#fff7ae", animation: "orbit" },
  { key: "ocean-wave", name: "Ocean Wave", description: "A cool animated wave frame.", primary: "#0ea5e9", secondary: "#14b8a6", accent: "#b8f3ff", animation: "shimmer" },
  { key: "neon-violet", name: "Neon Violet", description: "Electric violet for quick thinkers.", primary: "#d946ef", secondary: "#7c3aed", accent: "#f0abfc", animation: "pulse" },
  { key: "emerald-leaf", name: "Emerald Leaf", description: "A lively green botanical glow.", primary: "#10b981", secondary: "#84cc16", accent: "#d9f99d", animation: "orbit" },
  { key: "ruby-crown", name: "Ruby Crown", description: "A competitive red crown effect.", primary: "#ef4444", secondary: "#be123c", accent: "#fecaca", animation: "sparkle" },
  { key: "ice-crystal", name: "Ice Crystal", description: "A crisp crystalline frame.", primary: "#38bdf8", secondary: "#c4b5fd", accent: "#eff6ff", animation: "spin" },
  { key: "golden-comet", name: "Golden Comet", description: "A bright trail around your avatar.", primary: "#f59e0b", secondary: "#f97316", accent: "#fde68a", animation: "orbit" },
  { key: "midnight-stars", name: "Midnight Stars", description: "Deep space with subtle stars.", primary: "#312e81", secondary: "#111827", accent: "#c4b5fd", animation: "sparkle" },
  { key: "candy-pop", name: "Candy Pop", description: "A playful pink and blue loop.", primary: "#ec4899", secondary: "#8b5cf6", accent: "#fbcfe8", animation: "shimmer" },
]

export function avatarFramePreset(key: string | null | undefined) {
  return AVATAR_FRAME_PRESETS.find((preset) => preset.key === key) ?? null
}
