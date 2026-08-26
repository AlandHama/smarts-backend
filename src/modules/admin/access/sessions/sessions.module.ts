import { Module } from "@nestjs/common"

import { CreateSessionTransaction } from "./transactions/create-session-transaction"
import { EndAllSessionsTransaction } from "./transactions/end-all-sessions-transaction"
import { EndSessionTransaction } from "./transactions/end-session-transaction"
import { EndSessionByIdTransaction } from "./transactions/end-session-by-id-transaction"
import { RotateSessionTransaction } from "./transactions/rotate-session-transaction"
import { UpdateSessionLastActiveTransaction } from "./transactions/update-session-last-active-transaction"
import { SessionsService } from "./sessions.service"

@Module({
  providers: [
    SessionsService,
    CreateSessionTransaction,
    EndSessionTransaction,
    EndSessionByIdTransaction,
    EndAllSessionsTransaction,
    RotateSessionTransaction,
    UpdateSessionLastActiveTransaction,
  ],
  exports: [
    SessionsService,
    CreateSessionTransaction,
    EndSessionTransaction,
    EndSessionByIdTransaction,
    EndAllSessionsTransaction,
    RotateSessionTransaction,
    UpdateSessionLastActiveTransaction,
  ],
})
export class SessionsModule {}
