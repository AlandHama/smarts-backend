import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common"

@Injectable()
export class SystemAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest()
    if (!request.user?.isSystemAdmin) throw new ForbiddenException("System administrator access is required")
    return true
  }
}
