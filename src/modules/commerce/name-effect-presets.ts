export type NameEffectPreset = {
  key: string
  name: string
  description: string
  primary: string
  secondary: string
  accent: string
  animation: "pulse" | "shimmer" | "rainbow" | "glitch" | "sparkle" | "fire"
}

/** Server-owned name cosmetics. Asset metadata uses the same stable keys. */
export const NAME_EFFECT_PRESETS: readonly NameEffectPreset[] = [
  { key: "mint-glow", name: "Mint Glow", description: "A clean pulse of mint light.", primary: "#5eead4", secondary: "#22d3ee", accent: "#ecfeff", animation: "pulse" },
  { key: "skyline", name: "Skyline", description: "A cool blue shimmer for quick players.", primary: "#60a5fa", secondary: "#818cf8", accent: "#dbeafe", animation: "shimmer" },
  { key: "neon-cyan", name: "Neon Cyan", description: "Electric cyan that moves across your name.", primary: "#22d3ee", secondary: "#06b6d4", accent: "#cffafe", animation: "shimmer" },
  { key: "sunset-flare", name: "Sunset Flare", description: "A warm orange and pink moving glow.", primary: "#fb7185", secondary: "#f97316", accent: "#fed7aa", animation: "fire" },
  { key: "emerald-arc", name: "Emerald Arc", description: "A confident emerald pulse.", primary: "#34d399", secondary: "#10b981", accent: "#d1fae5", animation: "pulse" },
  { key: "ruby-royal", name: "Ruby Royal", description: "A red luxury gradient for rivals.", primary: "#fb7185", secondary: "#be123c", accent: "#ffe4e6", animation: "sparkle" },
  { key: "royal-gold", name: "Royal Gold", description: "A premium gold shimmer.", primary: "#fde68a", secondary: "#f59e0b", accent: "#fff7ae", animation: "sparkle" },
  { key: "holographic", name: "Holographic", description: "A shifting rainbow hologram.", primary: "#f0abfc", secondary: "#67e8f9", accent: "#fef3c7", animation: "rainbow" },
  { key: "galaxy-prism", name: "Galaxy Prism", description: "Deep-space colors with a prism sweep.", primary: "#c4b5fd", secondary: "#7c3aed", accent: "#f5d0fe", animation: "rainbow" },
  { key: "glitch-luxe", name: "Glitch Luxe", description: "A sharp animated cyber effect.", primary: "#f0fdf4", secondary: "#a3e635", accent: "#f472b6", animation: "glitch" },
]

export function nameEffectPreset(key: string | null | undefined) {
  return NAME_EFFECT_PRESETS.find((preset) => preset.key === key) ?? null
}
