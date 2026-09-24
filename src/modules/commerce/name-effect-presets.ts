export type NameEffectPreset = {
  key: string
  name: string
  description: string
  primary: string
  secondary: string
  accent: string
  animation: "pulse" | "shimmer" | "rainbow" | "glitch" | "sparkle" | "fire"
  rarity?: "standard" | "legendary"
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
  { key: "celestial-crown", name: "Celestial Crown", description: "A radiant crown of starlight for elite players.", primary: "#fef08a", secondary: "#a78bfa", accent: "#67e8f9", animation: "sparkle", rarity: "legendary" },
  { key: "diamond-elite", name: "Diamond Elite", description: "A brilliant diamond shimmer with icy highlights.", primary: "#e0f2fe", secondary: "#93c5fd", accent: "#ffffff", animation: "shimmer", rarity: "legendary" },
  { key: "inferno-royal", name: "Inferno Royal", description: "A fierce ember trail wrapped in royal crimson.", primary: "#ffedd5", secondary: "#f97316", accent: "#ef4444", animation: "fire", rarity: "legendary" },
  { key: "aurora-legend", name: "Aurora Legend", description: "A northern-light ribbon reserved for legends.", primary: "#99f6e4", secondary: "#818cf8", accent: "#f0abfc", animation: "rainbow", rarity: "legendary" },
  { key: "plasma-emperor", name: "Plasma Emperor", description: "A charged violet plasma wave with cyan sparks.", primary: "#f0abfc", secondary: "#c084fc", accent: "#22d3ee", animation: "pulse", rarity: "legendary" },
  { key: "obsidian-gold", name: "Obsidian Gold", description: "A dark-gold finish with a molten luxury glint.", primary: "#fff7ae", secondary: "#f59e0b", accent: "#292524", animation: "sparkle", rarity: "legendary" },
  { key: "cosmic-opal", name: "Cosmic Opal", description: "A deep-space opal prism that shifts through color.", primary: "#f5d0fe", secondary: "#67e8f9", accent: "#c4b5fd", animation: "rainbow", rarity: "legendary" },
  { key: "dragonfire", name: "Dragonfire", description: "A blazing gold-and-crimson effect with dragon energy.", primary: "#facc15", secondary: "#ef4444", accent: "#7f1d1d", animation: "fire", rarity: "legendary" },
  { key: "quantum-prism", name: "Quantum Prism", description: "A rare prism burst from the edge of the leaderboard.", primary: "#a7f3d0", secondary: "#f0abfc", accent: "#60a5fa", animation: "glitch", rarity: "legendary" },
  { key: "imperial-violet", name: "Imperial Violet", description: "A regal violet aura finished with a royal-gold sweep.", primary: "#ddd6fe", secondary: "#7c3aed", accent: "#fbbf24", animation: "shimmer", rarity: "legendary" },
]

export function nameEffectPreset(key: string | null | undefined) {
  return NAME_EFFECT_PRESETS.find((preset) => preset.key === key) ?? null
}
