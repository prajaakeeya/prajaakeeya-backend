import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  UseGuards,
  Req,
  UseInterceptors,
  Put,
  UploadedFile,
  Query,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiQuery,
} from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import { MAX_UPLOAD_BYTES } from "../common/upload.constants";
import { UsersService } from "./users.service";
import { CreateReportDto } from "./dto/create-report.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UpdateConstituenciesDto } from "./dto/update-constituencies.dto";
import { TrackInteractionDto } from "./dto/track-interaction.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AuthUser } from "../common/decorators/current-user.decorator";

type AuthedRequest = { user: AuthUser };

@ApiTags("Users")
@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get("voters")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get all voters with pagination" })
  @ApiQuery({
    name: "page",
    required: false,
    type: Number,
    description: "Page number (default 1)",
    example: 1,
  })
  @ApiQuery({
    name: "limit",
    required: false,
    type: Number,
    description: "Items per page (default 20, max 100)",
    example: 20,
  })
  @ApiQuery({
    name: "search",
    required: false,
    type: String,
    description: "Search by name (case-insensitive)",
  })
  @ApiResponse({ status: 200, description: "Paginated voters list returned" })
  async findAllVoters(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("search") search?: string,
  ) {
    const p = Math.max(1, Number(page) || 1);
    const l = Math.min(100, Math.max(1, Number(limit) || 20));
    return this.usersService.findAllVoters(p, l, search);
  }

  @Post("report")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UseInterceptors(
    FileInterceptor("attachment", {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  @ApiConsumes("multipart/form-data")
  @ApiOperation({
    summary: "Report a voter or aspirant",
    description:
      "Submit a report for a user/voter. Optionally attach a file (PDF, JPEG, PNG).",
  })
  @ApiBody({
    schema: {
      type: "object",
      required: ["reportedUserId", "reportedUserType", "reason"],
      properties: {
        reportedUserId: {
          type: "number",
          description: "ID of the user being reported",
          example: 123,
        },
        reportedUserType: {
          type: "string",
          enum: ["voter", "aspirant"],
          description: "Type of user being reported",
          example: "voter",
        },
        reason: {
          type: "string",
          description: "Reason for reporting",
          example: "This user does not belong to this ward",
        },
        attachment: {
          type: "string",
          format: "binary",
          description: "Optional attachment file (PDF, JPEG, or PNG)",
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: "Report created successfully" })
  @ApiResponse({ status: 404, description: "Reported user not found" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async createReport(
    @Body() createReportDto: CreateReportDto,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: AuthedRequest,
  ) {
    const reportedById = req.user?.id;
    return this.usersService.createReport(createReportDto, reportedById, file);
  }

  @Get("my-reports")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get reports submitted by the logged-in user" })
  @ApiResponse({
    status: 200,
    description: "List of reports submitted by the user",
  })
  async getMyReports(@Req() req: AuthedRequest) {
    return this.usersService.getReportsByUser(req.user.id);
  }

  @Delete("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Permanently delete voter account and all associated data",
  })
  @ApiResponse({ status: 200, description: "Account deleted or deactivated" })
  @ApiResponse({
    status: 400,
    description: "Only voters can delete their account",
  })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async deleteAccount(@Req() req: AuthedRequest) {
    return this.usersService.deleteAccount(req.user.id);
  }

  @Post("track/chat")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Track chat interaction" })
  @ApiResponse({
    status: 201,
    description: "Chat interaction tracked successfully",
  })
  @ApiResponse({ status: 404, description: "User not found" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async trackChat(@Body() dto: TrackInteractionDto, @Req() req: AuthedRequest) {
    const userId = req.user?.id;
    return this.usersService.trackChat(userId, dto.aspirantId);
  }

  @Post("track/meeting")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Track meeting booking" })
  @ApiResponse({
    status: 201,
    description: "Meeting interaction tracked successfully",
  })
  @ApiResponse({ status: 404, description: "User not found" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async trackMeeting(
    @Body() dto: TrackInteractionDto,
    @Req() req: AuthedRequest,
  ) {
    const userId = req.user?.id;
    return this.usersService.trackMeeting(userId, dto.aspirantId);
  }

  @Post("track/direct-meet")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Track direct meet request" })
  @ApiResponse({
    status: 201,
    description: "Direct meet interaction tracked successfully",
  })
  @ApiResponse({ status: 404, description: "User not found" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async trackDirectMeet(
    @Body() dto: TrackInteractionDto,
    @Req() req: AuthedRequest,
  ) {
    const userId = req.user?.id;
    return this.usersService.trackDirectMeet(userId, dto.aspirantId);
  }

  @Post("track/phone-call")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Track phone/WhatsApp ('contact') button press",
    description:
      "Reused for both the phone and WhatsApp buttons. Pass the click time as " +
      "`timestamp` (epoch ms); it's stored as phoneCallAt and makes the voter " +
      "eligible to rate this aspirant's contact.",
  })
  @ApiResponse({
    status: 201,
    description: "Phone call interaction tracked successfully",
  })
  @ApiResponse({ status: 404, description: "User not found" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async trackPhoneCall(
    @Body() dto: TrackInteractionDto,
    @Req() req: AuthedRequest,
  ) {
    const userId = req.user?.id;
    return this.usersService.trackPhoneCall(
      userId,
      dto.aspirantId,
      dto.timestamp ? new Date(dto.timestamp) : undefined,
    );
  }

  @Get("track/message")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get last interaction message for current user" })
  @ApiResponse({ status: 200, description: "Returns last interaction message" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async getLastInteractionMessage(@Req() req: AuthedRequest) {
    const userId = req.user?.id;
    const message = await this.usersService.getLastInteractionMessage(userId);
    return { message };
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get current user profile" })
  @ApiResponse({ status: 200, description: "User profile returned" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async getMe(@Req() req: AuthedRequest) {
    return this.usersService.getUserById(req.user.id);
  }

  @Put("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update current user profile" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        gender: { type: "string" },
        age: { type: "number" },
        lokSabhaConstituencyId: { type: "number" },
        stateAssemblyConstituencyId: { type: "number" },
        municipalCorporationConstituencyId: { type: "number" },
        gramPanchayatConstituencyId: { type: "number" },
      },
    },
  })
  @ApiResponse({ status: 200, description: "Profile updated successfully" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async updateMe(@Body() dto: UpdateUserDto, @Req() req: AuthedRequest) {
    const userId = req.user?.id;
    // Only allow specific fields to be updated by the user (no relativeName, epicId, wardId, or profilePicture)
    const allowed: Partial<UpdateUserDto> = {};
    if (dto.name !== undefined) allowed.name = dto.name;
    if (dto.phone !== undefined) allowed.phone = dto.phone;
    if (dto.gender !== undefined) allowed.gender = dto.gender;
    if (dto.age !== undefined) allowed.age = dto.age;
    if (dto.lokSabhaConstituencyId !== undefined)
      allowed.lokSabhaConstituencyId = dto.lokSabhaConstituencyId;
    if (dto.stateAssemblyConstituencyId !== undefined)
      allowed.stateAssemblyConstituencyId = dto.stateAssemblyConstituencyId;
    if (dto.municipalCorporationConstituencyId !== undefined)
      allowed.municipalCorporationConstituencyId =
        dto.municipalCorporationConstituencyId;
    if (dto.gramPanchayatConstituencyId !== undefined)
      allowed.gramPanchayatConstituencyId = dto.gramPanchayatConstituencyId;

    return this.usersService.updateUser(userId, allowed);
  }

  @Post("me/constituencies")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Set current user's constituency IDs for the four election types (Lok Sabha, State Assembly, Municipal Corporation, Gram Panchayat)",
  })
  @ApiResponse({ status: 200, description: "Constituencies updated" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async setConstituencies(
    @Body() dto: UpdateConstituenciesDto,
    @Req() req: AuthedRequest,
  ) {
    const userId = req.user?.id;
    return this.usersService.updateConstituencies(userId, dto);
  }
}
