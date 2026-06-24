import {
  Body,
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Sse,
  UseGuards,
  MessageEvent,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from "@nestjs/swagger";
import { Observable, interval, map, merge } from "rxjs";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { SseJwtAuthGuard } from "../common/guards/sse-jwt-auth.guard";
import {
  CurrentUser,
  AuthUser,
} from "../common/decorators/current-user.decorator";
import { AspirantChatService } from "./aspirant-chat.service";
import { ChatEventsService } from "./chat-events.service";
import { CreateAspirantMessageDto } from "./dto/create-aspirant-message.dto";
import { GetAspirantMessagesDto } from "./dto/get-aspirant-messages.dto";

@ApiTags("Aspirant Chat")
@Controller("aspirants/:aspirantId/chat")
export class AspirantChatController {
  constructor(
    private readonly chatService: AspirantChatService,
    private readonly chatEvents: ChatEventsService,
  ) {}

  @Sse("stream")
  @UseGuards(SseJwtAuthGuard)
  @ApiOperation({
    summary: "Live SSE stream of chat events for an aspirant room",
    description:
      "Server-Sent Events stream of new/deleted messages for the room. " +
      "Authenticate with `?token=<JWT>` since EventSource cannot set headers. " +
      "Emits `message.created` and `message.deleted` events plus periodic " +
      "`ping` heartbeats. Load history via GET; send via POST.",
  })
  @ApiParam({ name: "aspirantId", type: "number", example: 1 })
  stream(@Param("aspirantId") aspirantId: string): Observable<MessageEvent> {
    const id = Number(aspirantId);
    const events$ = this.chatEvents
      .forRoom(id)
      .pipe(map((e) => ({ type: e.type, data: e.payload }) as MessageEvent));
    // Heartbeat keeps the connection alive through proxies (Cloudflare idle ~100s).
    const heartbeat$ = interval(25000).pipe(
      map(() => ({ type: "ping", data: "" }) as MessageEvent),
    );
    return merge(events$, heartbeat$);
  }

  @Post("messages")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Post a message to an aspirant's chat room" })
  @ApiParam({
    name: "aspirantId",
    type: "number",
    description: "Aspirant ID",
    example: 1,
  })
  @ApiResponse({ status: 201, description: "Message posted" })
  postMessage(
    @CurrentUser() user: AuthUser,
    @Param("aspirantId") aspirantId: string,
    @Body() dto: CreateAspirantMessageDto,
  ) {
    return this.chatService.createMessage(user.id, Number(aspirantId), dto);
  }

  @Get("messages")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get messages for an aspirant's chat room" })
  @ApiParam({
    name: "aspirantId",
    type: "number",
    description: "Aspirant ID",
    example: 1,
  })
  @ApiResponse({ status: 200, description: "Messages returned" })
  getMessages(
    @Param("aspirantId") aspirantId: string,
    @Query() query: GetAspirantMessagesDto,
  ) {
    return this.chatService.getMessages(Number(aspirantId), query);
  }

  @Delete("messages/:messageId")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Delete your message in aspirant chat room" })
  @ApiParam({
    name: "aspirantId",
    type: "number",
    description: "Aspirant ID",
    example: 1,
  })
  @ApiParam({
    name: "messageId",
    type: "number",
    description: "Message ID",
    example: 10,
  })
  deleteMessage(
    @CurrentUser() user: AuthUser,
    @Param("messageId") messageId: string,
  ) {
    return this.chatService.deleteMessage(Number(messageId), user.id);
  }
}
