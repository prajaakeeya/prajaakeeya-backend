import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { NotificationsService } from "./notifications.service";
import { FirebaseService } from "./firebase.service";
import {
  RegisterDeviceTokenDto,
  RemoveDeviceTokenDto,
} from "./dto/device-token.dto";

@ApiTags("Notifications")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly service: NotificationsService,
    private readonly firebase: FirebaseService,
  ) {}

  // Declared before the ":id" routes so "device-token" isn't captured as an id.
  @Post("device-token")
  @ApiOperation({ summary: "Register an FCM device token for web push" })
  @ApiResponse({ status: 201, description: "Token registered" })
  async registerDeviceToken(
    @CurrentUser() user: any,
    @Body() dto: RegisterDeviceTokenDto,
  ) {
    await this.firebase.registerToken(user.id, dto.token, dto.platform);
    return { ok: true };
  }

  @Delete("device-token")
  @ApiOperation({ summary: "Unregister an FCM device token (e.g. on logout)" })
  @ApiResponse({ status: 200, description: "Token removed" })
  async unregisterDeviceToken(
    @CurrentUser() user: any,
    @Body() dto: RemoveDeviceTokenDto,
  ) {
    await this.firebase.removeToken(user.id, dto.token);
    return { ok: true };
  }

  @Get()
  @ApiOperation({
    summary: "List in-app notifications for the authenticated user",
  })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiQuery({ name: "unreadOnly", required: false, type: Boolean })
  @ApiResponse({ status: 200, description: "Paginated list of notifications" })
  list(
    @CurrentUser() user: any,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("unreadOnly") unreadOnly?: string,
  ) {
    return this.service.list(user.id, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      unreadOnly: unreadOnly === "true",
    });
  }

  @Get("unread-count")
  @ApiOperation({ summary: "Get unread notification count" })
  @ApiResponse({ status: 200, description: "Unread count returned" })
  async unreadCount(@CurrentUser() user: any) {
    const count = await this.service.unreadCount(user.id);
    return { unreadCount: count };
  }

  @Post(":id/read")
  @ApiOperation({ summary: "Mark a single notification as read" })
  @ApiParam({ name: "id", type: "number" })
  @ApiResponse({ status: 200, description: "Notification marked as read" })
  @ApiResponse({ status: 404, description: "Notification not found" })
  markRead(@CurrentUser() user: any, @Param("id") id: string) {
    return this.service.markRead(user.id, Number(id));
  }

  @Post("read-all")
  @ApiOperation({
    summary: "Mark every unread notification as read for this user",
  })
  @ApiResponse({ status: 200, description: "Notifications marked as read" })
  markAllRead(@CurrentUser() user: any) {
    return this.service.markAllRead(user.id);
  }

  @Delete()
  @ApiOperation({
    summary: "Delete every notification for this user",
  })
  @ApiResponse({ status: 200, description: "Notifications deleted" })
  deleteAll(@CurrentUser() user: any) {
    return this.service.deleteAll(user.id);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a single notification" })
  @ApiParam({ name: "id", type: "number" })
  @ApiResponse({ status: 200, description: "Notification deleted" })
  @ApiResponse({ status: 404, description: "Notification not found" })
  delete(@CurrentUser() user: any, @Param("id") id: string) {
    return this.service.deleteOne(user.id, Number(id));
  }
}
