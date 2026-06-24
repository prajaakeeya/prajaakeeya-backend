import {
  Body,
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import {
  CurrentUser,
  AuthUser,
} from "../common/decorators/current-user.decorator";
import { ForumService } from "./forum.service";
import { CreateMessageDto } from "./dto/create-message.dto";
import { GetMessagesDto } from "./dto/get-messages.dto";

@ApiTags("Forum")
@Controller("forum")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ForumController {
  constructor(private readonly forumService: ForumService) {}

  @Post("ward/:wardId/messages")
  @ApiOperation({ summary: "Post a message in a ward forum" })
  @ApiParam({
    name: "wardId",
    type: "number",
    description: "Ward ID",
    example: 1,
  })
  @ApiResponse({ status: 201, description: "Message posted successfully" })
  @ApiResponse({ status: 400, description: "Invalid request" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({
    status: 403,
    description: "User does not belong to this ward",
  })
  async postMessage(
    @CurrentUser() user: AuthUser,
    @Param("wardId") wardId: string,
    @Body() dto: CreateMessageDto,
  ) {
    const wardIdNum = Number(wardId);

    // Check if user belongs to the ward
    if (user.wardId !== wardIdNum) {
      throw new BadRequestException(
        "You can only post messages in your own ward",
      );
    }

    return this.forumService.createMessage(user.id, wardIdNum, dto);
  }

  @Get("ward/:wardId/messages")
  @ApiOperation({ summary: "Get all messages from a ward forum" })
  @ApiParam({
    name: "wardId",
    type: "number",
    description: "Ward ID",
    example: 1,
  })
  @ApiResponse({ status: 200, description: "Messages retrieved successfully" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async getMessages(
    @Param("wardId") wardId: string,
    @Query() query: GetMessagesDto,
  ) {
    return this.forumService.getWardMessages(Number(wardId), query);
  }

  @Delete("messages/:messageId")
  @ApiOperation({ summary: "Delete your own message" })
  @ApiParam({
    name: "messageId",
    type: "number",
    description: "Message ID",
    example: 1,
  })
  @ApiResponse({ status: 200, description: "Message deleted successfully" })
  @ApiResponse({
    status: 403,
    description: "Can only delete your own messages",
  })
  @ApiResponse({ status: 404, description: "Message not found" })
  async deleteMessage(
    @CurrentUser() user: AuthUser,
    @Param("messageId") messageId: string,
  ) {
    return this.forumService.deleteMessage(Number(messageId), user.id);
  }
}
