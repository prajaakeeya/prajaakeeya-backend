import {
  Body,
  Controller,
  Post,
  UseGuards,
  Get,
  Param,
  Delete,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AspirantWardMeetingsService } from "./aspirant-ward-meetings.service";
import { CreateAspirantWardMeetingDto } from "./dto/create-aspirant-ward-meeting.dto";
import { CompleteWardMeetingDto } from "./dto/complete-ward-meeting.dto";
import {
  CurrentUser,
  AuthUser,
} from "../common/decorators/current-user.decorator";

@ApiTags("Aspirant Ward Meetings")
@Controller("aspirant-ward-meetings")
export class AspirantWardMeetingsController {
  constructor(private readonly service: AspirantWardMeetingsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Aspirant: create a ward-level meeting for their ward",
  })
  @ApiResponse({ status: 201, description: "Meeting created successfully" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateAspirantWardMeetingDto,
  ) {
    return this.service.createMeetingForAspirant(user.id, dto);
  }

  @Get("my")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Return active ward meetings for the authenticated aspirant's ward",
  })
  @ApiResponse({ status: 200, description: "Meetings returned successfully" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({
    status: 404,
    description: "Aspirant profile not found for this user",
  })
  my(@CurrentUser() user: AuthUser) {
    return this.service.getMeetingsForUserWard(user.id);
  }

  @Post(":meetingId/complete")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Mark a ward meeting as completed with notes" })
  @ApiParam({
    name: "meetingId",
    type: "number",
    description: "Ward meeting ID",
  })
  @ApiResponse({ status: 200, description: "Meeting marked completed" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  complete(
    @CurrentUser() user: AuthUser,
    @Param("meetingId") meetingId: string,
    @Body() dto: CompleteWardMeetingDto,
  ) {
    return this.service.completeMeeting(user.id, Number(meetingId), dto.notes);
  }

  @Delete(":meetingId")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Delete a ward meeting created for the aspirant's ward",
  })
  @ApiParam({
    name: "meetingId",
    type: "number",
    description: "Ward meeting ID",
  })
  @ApiResponse({ status: 200, description: "Meeting deleted" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  delete(@CurrentUser() user: AuthUser, @Param("meetingId") meetingId: string) {
    return this.service.deleteMeeting(user.id, Number(meetingId));
  }
}
