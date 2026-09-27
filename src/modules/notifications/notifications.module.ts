import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { NotificationsController } from "./notifications.controller"
import { NotificationsService } from "./notifications.service"
import { FirebaseMessagingService } from "./firebase-messaging.service"

@Module({ imports: [DatabaseModule], controllers: [NotificationsController], providers: [NotificationsService, FirebaseMessagingService], exports: [NotificationsService, FirebaseMessagingService] })
export class NotificationsModule {}
