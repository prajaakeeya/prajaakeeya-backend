import {
  Body,
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import {
  CurrentUser,
  AuthUser,
} from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { AspirantDiscussionService } from "./aspirant-discussion.service";
import { CreateAspirantDiscussionMessageDto } from "./dto/create-aspirant-discussion-message.dto";
import { GetAspirantDiscussionMessagesDto } from "./dto/get-aspirant-discussion-messages.dto";

@ApiTags("Aspirant Discussion")
@Controller("aspirant-discussion")
export class AspirantDiscussionController {
  constructor(private readonly discussionService: AspirantDiscussionService) {}

  @Post("aspirant/:aspirantId/messages")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Post a message in aspirant discussion room (aspirants only)",
  })
  @ApiParam({
    name: "aspirantId",
    type: "number",
    description: "Aspirant ID",
    example: 1,
  })
  @ApiResponse({ status: 201, description: "Message posted successfully" })
  @ApiResponse({ status: 403, description: "Only aspirants can post messages" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async postMessage(
    @CurrentUser() user: AuthUser,
    @Param("aspirantId") aspirantId: string,
    @Body() dto: CreateAspirantDiscussionMessageDto,
  ) {
    return this.discussionService.createMessage(
      user.id,
      user.role,
      Number(aspirantId),
      dto,
    );
  }

  @Get("ward/:wardNumber/messages")
  @UseGuards(JwtAuthGuard)
  @Public()
  @ApiOperation({
    summary:
      "Get all aspirants discussion messages for a ward (voters can read)",
  })
  @ApiParam({
    name: "wardNumber",
    type: "string",
    description: "Ward number",
    example: "42",
  })
  @ApiQuery({
    name: "page",
    required: false,
    type: "number",
    description: "Page number",
    example: 1,
  })
  @ApiQuery({
    name: "limit",
    required: false,
    type: "number",
    description: "Items per page",
    example: 50,
  })
  @ApiResponse({ status: 200, description: "Messages retrieved successfully" })
  async getMessages(
    @Param("wardNumber") wardNumber: string,
    @Query() query: GetAspirantDiscussionMessagesDto,
  ) {
    return this.discussionService.getMessages(wardNumber, query);
  }

  @Delete("messages/:messageId")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Delete a message (own message or admin)" })
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
    return this.discussionService.deleteMessage(
      Number(messageId),
      user.id,
      user.role,
    );
  }
}
