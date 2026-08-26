import bcrypt from "bcryptjs"

export class HashHelper {
  private static readonly saltRounds = 12

  static encrypt(value: string): Promise<string> {
    return bcrypt.hash(value, this.saltRounds)
  }

  static compare(value: string, hash: string): Promise<boolean> {
    return bcrypt.compare(value, hash)
  }
}
