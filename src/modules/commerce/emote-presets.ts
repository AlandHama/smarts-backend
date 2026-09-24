export type EmotePreset = {
  key: string
  name: string
  description: string
  icon: string
  rarity: "free" | "common" | "rare" | "epic" | "legendary"
  free: boolean
  priceGld: number
}

const definitions: Array<[string, string, string, string, EmotePreset["rarity"], boolean, number]> = [
  ["laugh", "Laugh", "A bright victory laugh.", "😂", "free", true, 0], ["clap", "Clap", "Give a player some applause.", "👏", "free", true, 0], ["fire", "Fire", "That play was on fire.", "🔥", "free", true, 0], ["cool", "Cool", "A classic cool reaction.", "😎", "free", true, 0], ["skull", "Skull", "That move was deadly.", "💀", "free", true, 0],
  ["heart", "Heart", "Send a little love.", "💖", "common", false, 5], ["gg", "Good game", "Respect the match.", "🤝", "common", false, 5], ["wow", "Wow", "For an unbelievable play.", "🤯", "common", false, 10], ["cry", "Tears", "A dramatic reaction.", "😭", "common", false, 10], ["angry", "Rage", "Bring the heat.", "😤", "common", false, 10],
  ["party", "Party", "Celebrate in style.", "🥳", "rare", false, 15], ["crown", "Crown", "A royal reaction.", "👑", "rare", false, 20], ["rocket", "Rocket", "Launch into the next round.", "🚀", "rare", false, 20], ["ghost", "Ghost", "A spooky disappearing act.", "👻", "rare", false, 25], ["hundred", "Hundred", "Perfect energy.", "💯", "rare", false, 25],
  ["sparkles", "Sparkles", "Add a little magic.", "✨", "epic", false, 30], ["mind-blown", "Mind blown", "For a genius answer.", "🤩", "epic", false, 35], ["salute", "Salute", "Respect the opponent.", "🫡", "epic", false, 40], ["sleepy", "Sleepy", "A very patient player.", "😴", "epic", false, 40], ["sweat", "Sweat", "That was too close.", "😅", "epic", false, 45],
  ["poop", "Oops", "A playful miss.", "💩", "epic", false, 50], ["pray", "Pray", "Trust the next answer.", "🙏", "epic", false, 50], ["star-struck", "Star struck", "A legendary moment.", "🤩", "legendary", false, 60], ["eyes", "Eyes", "Everyone is watching.", "👀", "legendary", false, 60], ["trophy", "Trophy", "Claim the spotlight.", "🏆", "legendary", false, 75], ["diamond", "Diamond", "A brilliant reaction.", "💎", "legendary", false, 100], ["lightning", "Lightning", "Instant impact.", "⚡", "legendary", false, 100], ["rainbow", "Rainbow", "A colorful celebration.", "🌈", "legendary", false, 125], ["dragon", "Dragon", "Unleash a mythic reaction.", "🐉", "legendary", false, 150], ["galaxy", "Galaxy", "The ultimate cosmic emote.", "🌌", "legendary", false, 200],
]

export const EMOTE_PRESETS: EmotePreset[] = definitions.map(([key, name, description, icon, rarity, free, priceGld]) => ({ key, name, description, icon, rarity, free, priceGld }))
export function emotePreset(key: string) { return EMOTE_PRESETS.find((preset) => preset.key === key) }
