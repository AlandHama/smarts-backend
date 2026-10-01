import { Injectable } from "@nestjs/common"

/** In-process live-chat presence used to avoid tray pushes for an open thread. */
@Injectable()
export class ChatPresenceRegistry {
  private readonly users = new Map<string, Map<string, number>>()

  subscribe(userId: string, conversationId: string) {
    const conversations = this.users.get(userId) ?? new Map<string, number>()
    conversations.set(conversationId, (conversations.get(conversationId) ?? 0) + 1)
    this.users.set(userId, conversations)
  }

  unsubscribe(userId: string, conversationId: string) {
    const conversations = this.users.get(userId)
    if (!conversations) return
    const count = (conversations.get(conversationId) ?? 0) - 1
    if (count > 0) conversations.set(conversationId, count)
    else conversations.delete(conversationId)
    if (!conversations.size) this.users.delete(userId)
  }

  clearUser(userId: string, conversationIds: Iterable<string>) {
    for (const conversationId of conversationIds) this.unsubscribe(userId, conversationId)
  }

  isActive(userId: string, conversationId: string) {
    return (this.users.get(userId)?.get(conversationId) ?? 0) > 0
  }
}
