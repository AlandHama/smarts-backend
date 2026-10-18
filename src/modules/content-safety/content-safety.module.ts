import { Global, Module } from "@nestjs/common"

import { ContentSafetyService } from "./content-safety.service"

@Global()
@Module({
  providers: [ContentSafetyService],
  exports: [ContentSafetyService],
})
export class ContentSafetyModule {}
