export interface JwtPayload {
  sub: string
  userId: string
  username: string
  tokenId: string
  tokenUse: "ACCESS_TOKEN" | "REFRESH_TOKEN"
  iat?: number
  exp?: number
}
