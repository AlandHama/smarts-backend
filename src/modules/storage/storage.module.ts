import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { StorageController } from "./storage.controller"
import { StorageService } from "./storage.service"
import { CreateFeedbackTransaction } from "./transactions/create-feedback-transaction"
import { UpdateFeedbackTransaction } from "./transactions/update-feedback-transaction"
import { UpdatePlayerStorageTransaction } from "./transactions/update-player-storage-transaction"
import { DeletePlayerStorageTransaction } from "./transactions/delete-player-storage-transaction"

@Module({ imports: [DatabaseModule], controllers: [StorageController], providers: [StorageService, UpdatePlayerStorageTransaction, DeletePlayerStorageTransaction, CreateFeedbackTransaction, UpdateFeedbackTransaction], exports: [StorageService] })
export class StorageModule {}
