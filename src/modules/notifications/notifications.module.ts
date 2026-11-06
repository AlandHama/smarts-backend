import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { NotificationsController } from "./notifications.controller"
import { NotificationsService } from "./notifications.service"
import { FirebaseMessagingService } from "./firebase-messaging.service"
import { DailyHintsModule } from "../daily-hints/daily-hints.module"

@Module({ imports: [DatabaseModule, DailyHintsModule], controllers: [NotificationsController], providers: [NotificationsService, FirebaseMessagingService], exports: [NotificationsService, FirebaseMessagingService] })
export class NotificationsModule {}
