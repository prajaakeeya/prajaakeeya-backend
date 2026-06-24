import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
  Delete,
  Query,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from "@nestjs/swagger";
import {
  CurrentUser,
  AuthUser,
} from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { OptionalJwtAuthGuard } from "../common/guards/optional-jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { AspirantsService } from "./aspirants.service";
import { CreateAspirantDto } from "./dto/create-aspirant.dto";
import { SetMeetingLinkDto } from "./dto/set-meeting-link.dto";
import { CompleteMeetingDto } from "./dto/complete-meeting.dto";
import { CreateBookingDto } from "./dto/create-booking.dto";
import { CreateVisitDto } from "./dto/create-visit.dto";
import { RespondVisitDto } from "./dto/respond-visit.dto";
import { RespondMeetingDto } from "./dto/respond-meeting.dto";
import { DeleteMeetingsDto } from "./dto/delete-meetings.dto";
import { RateActivityDto } from "./dto/rate-activity.dto";
import { UpdateAspirantDto } from "./dto/update-aspirant.dto";
import { UpdateAspirantPermissionsDto } from "./dto/update-aspirant-permissions.dto";
import { DeclareCandidacyDto } from "./dto/declare-candidacy.dto";
import { CreateProposalDto } from "./dto/create-proposal.dto";
import { UpdateProposalDto } from "./dto/update-proposal.dto";

@ApiTags("Aspirants")
@Controller("aspirants")
export class AspirantsController {
  constructor(private readonly aspirantsService: AspirantsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Submit aspirant profile",
    description: "Creates aspirant profile and updates user role to aspirant.",
  })
  @ApiResponse({ status: 201, description: "Aspirant registered successfully" })
  @ApiResponse({
    status: 400,
    description: "Validation error or phone already in use",
  })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAspirantDto) {
    return this.aspirantsService.register(dto, user);
  }

  @Get("all")
  @Public()
  @ApiOperation({
    summary: "List all aspirants with election and constituency names",
  })
  @ApiQuery({
    name: "page",
    required: false,
    type: Number,
    description: "Page number (default 1)",
  })
  @ApiQuery({
    name: "limit",
    required: false,
    type: Number,
    description: "Items per page (default 20)",
  })
  @ApiQuery({
    name: "search",
    required: false,
    type: String,
    description: "Search by name (case-insensitive)",
  })
  @ApiResponse({ status: 200, description: "Paginated list of aspirants" })
  findAll(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("search") search?: string,
  ) {
    return this.aspirantsService.findAllAspirants(
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
      search,
    );
  }

  @Get("by-constituency")
  @Public()
  @ApiOperation({
    summary: "Get all aspirants by election and constituency",
    description:
      "Pass the election ID and constituency ID (parliamentary/assembly/ward depending on election type)",
  })
  @ApiQuery({
    name: "electionId",
    required: true,
    type: Number,
    description: "Election ID from GET /elections",
  })
  @ApiQuery({
    name: "constituencyId",
    required: true,
    type: Number,
    description: "Constituency ID from GET /elections/:type/constituencies",
  })
  @ApiQuery({
    name: "userId",
    required: false,
    type: Number,
    description:
      "Optional user ID — if passed, each meeting/visit includes an isRated flag",
  })
  @ApiResponse({ status: 200, description: "Aspirants returned successfully" })
  findByConstituency(
    @Query("electionId") electionId: string,
    @Query("constituencyId") constituencyId: string,
    @Query("userId") userId?: string,
  ) {
    return this.aspirantsService.findByConstituency(
      Number(electionId),
      Number(constituencyId),
      userId ? Number(userId) : undefined,
    );
  }

  @Delete("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Aspirant withdraws candidacy and reverts to voter",
  })
  @ApiResponse({
    status: 200,
    description: "Aspirant record deleted, role reverted to voter",
  })
  @ApiResponse({
    status: 404,
    description: "No aspirant profile found for this user",
  })
  withdraw(@CurrentUser() user: AuthUser) {
    return this.aspirantsService.withdrawAspirant(user.id);
  }

  @Get(":id")
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Get aspirant details by id",
    description:
      "Public. If a valid token is supplied and the caller is the aspirant owner, their private contact details (phone/whatsapp) are included regardless of the allow* flags.",
  })
  @ApiParam({
    name: "id",
    type: "number",
    description: "Aspirant ID",
    example: 5,
  })
  @ApiResponse({ status: 200, description: "Aspirant returned successfully" })
  @ApiResponse({ status: 404, description: "Aspirant not found" })
  findOne(@Param("id") id: string, @CurrentUser() user?: AuthUser) {
    const numId = Number(id);
    if (isNaN(numId)) return null;
    return this.aspirantsService.findOne(numId, user);
  }

  @Post("meeting")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Set meeting link for multiple aspirants" })
  @ApiResponse({
    status: 200,
    description: "Meeting links set successfully for all aspirants",
  })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 404, description: "One or more aspirants not found" })
  setMeeting(@CurrentUser() user: AuthUser, @Body() dto: SetMeetingLinkDto) {
    return this.aspirantsService.setMeetingLinkForMultiple(
      dto.aspirantIds,
      dto.meetingLink,
      dto.startTime,
      dto.endTime,
      dto.title,
      dto.description,
      dto.platform,
      user,
    );
  }

  @Post(":id/meeting/:meetingId/complete")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Mark a meeting as completed with notes" })
  @ApiParam({
    name: "id",
    type: "number",
    description: "Aspirant ID",
    example: 5,
  })
  @ApiParam({
    name: "meetingId",
    type: "number",
    description: "Meeting ID",
    example: 12,
  })
  completeMeeting(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("meetingId") meetingId: string,
    @Body() dto: CompleteMeetingDto,
  ) {
    return this.aspirantsService.completeMeeting(
      Number(id),
      Number(meetingId),
      dto.notes,
      user,
    );
  }

  @Get(":id/meeting")
  @Public()
  @ApiOperation({ summary: "Get meeting link for an aspirant" })
  @ApiParam({
    name: "id",
    type: "number",
    description: "Aspirant ID",
    example: 5,
  })
  @ApiResponse({
    status: 200,
    description: "Meeting link returned successfully",
  })
  @ApiResponse({ status: 404, description: "Aspirant not found" })
  async getMeeting(@Param("id") id: string) {
    const aspirant = await this.aspirantsService.findOne(Number(id));
    return { meetings: aspirant?.meetings ?? [] };
  }

  @Post(":id/book")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Book a direct visit with an aspirant (voter)" })
  @ApiParam({
    name: "id",
    type: "number",
    description: "Aspirant ID",
    example: 5,
  })
  @ApiResponse({ status: 201, description: "Booking created" })
  book(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: CreateBookingDto,
  ) {
    return this.aspirantsService.createBooking(
      Number(id),
      user.id,
      dto.message,
      dto.preferredAt,
    );
  }

  @Get(":id/bookings")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List bookings for an aspirant (aspirant access)" })
  @ApiParam({
    name: "id",
    type: "number",
    description: "Aspirant ID",
    example: 5,
  })
  bookings(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.aspirantsService.listBookingsForAspirant(
      Number(id),
      user,
      page ? Number(page) : undefined,
      limit ? Number(limit) : undefined,
    );
  }

  @Post(":id/visits")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Aspirant posts a visit for voters" })
  @ApiParam({
    name: "id",
    type: "number",
    description: "Aspirant ID",
    example: 5,
  })
  @ApiResponse({ status: 201, description: "Visit created" })
  createVisit(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: CreateVisitDto,
  ) {
    return this.aspirantsService.createVisit(
      Number(id),
      dto.startTime,
      dto.endTime,
      dto.title,
      dto.description,
      dto.location,
      dto.googleMapsLink,
      user,
    );
  }

  @Get(":id/visits")
  @Public()
  @ApiOperation({ summary: "Get visits for an aspirant" })
  @ApiParam({
    name: "id",
    type: "number",
    description: "Aspirant ID",
    example: 5,
  })
  getVisits(
    @Param("id") id: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.aspirantsService.listVisitsForAspirant(
      Number(id),
      page ? Number(page) : undefined,
      limit ? Number(limit) : undefined,
    );
  }

  @Post("visits/:visitId/respond")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Voter responds to a visit (attending or not)" })
  @ApiParam({
    name: "visitId",
    type: "number",
    description: "Visit ID",
    example: 10,
  })
  @ApiResponse({ status: 201, description: "Response recorded" })
  respondVisit(
    @CurrentUser() user: AuthUser,
    @Param("visitId") visitId: string,
    @Body() dto: RespondVisitDto,
  ) {
    return this.aspirantsService.respondToVisit(
      Number(visitId),
      user.id,
      dto.attending,
    );
  }

  @Post("meetings/:meetingId/respond")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Voter responds to a meeting (attending or not)" })
  @ApiParam({
    name: "meetingId",
    type: "number",
    description: "Meeting ID",
    example: 10,
  })
  @ApiResponse({
    status: 201,
    description:
      "Response recorded with updated attendingCount and notAttendingCount",
  })
  respondMeeting(
    @CurrentUser() user: AuthUser,
    @Param("meetingId") meetingId: string,
    @Body() dto: RespondMeetingDto,
  ) {
    return this.aspirantsService.respondToMeeting(
      Number(meetingId),
      user.id,
      dto.attending,
    );
  }

  @Get("visits/:visitId/responses")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get responses for a visit" })
  @ApiParam({
    name: "visitId",
    type: "number",
    description: "Visit ID",
    example: 10,
  })
  getVisitResponses(
    @Param("visitId") visitId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.aspirantsService.getVisitResponses(Number(visitId), user);
  }

  @Delete("meeting")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Delete multiple meetings by IDs" })
  @ApiResponse({ status: 200, description: "Meetings deleted successfully" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  deleteMeetings(
    @CurrentUser() user: AuthUser,
    @Body() dto: DeleteMeetingsDto,
  ) {
    return this.aspirantsService.deleteMeetings(dto.meetingIds, user);
  }

  @Delete(":id/visits/:visitId")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Delete a single visit for an aspirant" })
  @ApiParam({
    name: "id",
    type: "number",
    description: "Aspirant ID",
    example: 5,
  })
  @ApiParam({
    name: "visitId",
    type: "number",
    description: "Visit ID",
    example: 10,
  })
  @ApiResponse({ status: 200, description: "Visit deleted" })
  deleteVisit(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("visitId") visitId: string,
  ) {
    return this.aspirantsService.deleteVisit(Number(id), Number(visitId), user);
  }

  @Post("meetings/:meetingId/rate")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Rate a meeting (1-5)" })
  @ApiParam({
    name: "meetingId",
    type: "number",
    description: "Meeting ID",
    example: 12,
  })
  @ApiResponse({ status: 201, description: "Rating saved" })
  rateMeeting(
    @CurrentUser() user: AuthUser,
    @Param("meetingId") meetingId: string,
    @Body() dto: RateActivityDto,
  ) {
    return this.aspirantsService.rateMeeting(
      Number(meetingId),
      user.id,
      dto.rating,
    );
  }

  @Post("visits/:visitId/rate")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Rate a visit (1-5)" })
  @ApiParam({
    name: "visitId",
    type: "number",
    description: "Visit ID",
    example: 10,
  })
  @ApiResponse({ status: 201, description: "Rating saved" })
  rateVisit(
    @CurrentUser() user: AuthUser,
    @Param("visitId") visitId: string,
    @Body() dto: RateActivityDto,
  ) {
    return this.aspirantsService.rateVisit(
      Number(visitId),
      user.id,
      dto.rating,
    );
  }

  @Post(":aspirantId/contact/rate")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Rate an aspirant's contact — phone + WhatsApp combined (1-5)",
  })
  @ApiParam({
    name: "aspirantId",
    type: "number",
    description: "Aspirant ID",
    example: 1,
  })
  @ApiResponse({ status: 201, description: "Contact rating saved" })
  rateContact(
    @CurrentUser() user: AuthUser,
    @Param("aspirantId") aspirantId: string,
    @Body() dto: RateActivityDto,
  ) {
    return this.aspirantsService.rateContact(
      Number(aspirantId),
      user.id,
      dto.rating,
    );
  }

  @Patch(":id/permissions")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Update aspirant contact permissions (phone, whatsapp, chat)",
  })
  @ApiParam({
    name: "id",
    type: "number",
    description: "Aspirant ID",
    example: 5,
  })
  @ApiResponse({ status: 200, description: "Permissions updated" })
  @ApiResponse({ status: 404, description: "Aspirant not found" })
  updatePermissions(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: UpdateAspirantPermissionsDto,
  ) {
    return this.aspirantsService.updatePermissions(Number(id), user.id, dto);
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Edit aspirant profile fields" })
  @ApiParam({
    name: "id",
    type: "number",
    description: "Aspirant ID",
    example: 5,
  })
  @ApiResponse({ status: 200, description: "Aspirant updated successfully" })
  @ApiResponse({ status: 404, description: "Aspirant not found" })
  updateAspirant(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: UpdateAspirantDto,
  ) {
    return this.aspirantsService.updateAspirant(Number(id), user.id, dto);
  }

  @Patch(":id/candidacy")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Declare (or add another) candidacy",
    description:
      "Lets an aspirant declare an election/constituency once an election has " +
      "been announced. Calling this again for a different election type adds " +
      "an additional candidacy (e.g. Lok Sabha + Gram Panchayat at once) " +
      "rather than replacing the first — see GET :id/candidacies for the full list.",
  })
  @ApiParam({
    name: "id",
    type: "number",
    description: "Aspirant ID",
    example: 5,
  })
  @ApiResponse({ status: 200, description: "Candidacy declared successfully" })
  @ApiResponse({ status: 404, description: "Aspirant not found" })
  declareCandidacy(
    @CurrentUser() user: any,
    @Param("id") id: string,
    @Body() dto: DeclareCandidacyDto,
  ) {
    return this.aspirantsService.declareCandidacy(Number(id), user.id, dto);
  }

  @Get(":id/candidacies")
  @Public()
  @ApiOperation({
    summary: "List all races an aspirant has declared candidacy for",
  })
  @ApiParam({ name: "id", type: "number", description: "Aspirant ID", example: 5 })
  listCandidacies(@Param("id") id: string) {
    return this.aspirantsService.listCandidacies(Number(id));
  }

  @Delete("candidacies/:candidacyId")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Withdraw from one race, keeping other declared candidacies active",
  })
  @ApiParam({ name: "candidacyId", type: "number", example: 9 })
  removeCandidacy(
    @CurrentUser() user: any,
    @Param("candidacyId") candidacyId: string,
  ) {
    return this.aspirantsService.removeCandidacy(Number(candidacyId), user.id);
  }

  @Post(":id/proposals")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Aspirant creates a project/idea for citizens to back",
  })
  @ApiParam({ name: "id", type: "number", description: "Aspirant ID", example: 5 })
  @ApiResponse({ status: 201, description: "Proposal created" })
  createProposal(
    @CurrentUser() user: any,
    @Param("id") id: string,
    @Body() dto: CreateProposalDto,
  ) {
    return this.aspirantsService.createProposal(Number(id), user.id, dto);
  }

  @Get(":id/proposals")
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "List an aspirant's proposals, with support counts",
    description:
      "Public. If a valid token is supplied, each proposal includes isSupportedByMe.",
  })
  @ApiParam({ name: "id", type: "number", description: "Aspirant ID", example: 5 })
  listProposals(@Param("id") id: string, @CurrentUser() user?: any) {
    return this.aspirantsService.listProposals(Number(id), user?.id);
  }

  @Patch("proposals/:proposalId")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Aspirant edits their own proposal" })
  @ApiParam({ name: "proposalId", type: "number", example: 12 })
  updateProposal(
    @CurrentUser() user: any,
    @Param("proposalId") proposalId: string,
    @Body() dto: UpdateProposalDto,
  ) {
    return this.aspirantsService.updateProposal(
      Number(proposalId),
      user.id,
      dto,
    );
  }

  @Delete("proposals/:proposalId")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Aspirant deletes their own proposal" })
  @ApiParam({ name: "proposalId", type: "number", example: 12 })
  deleteProposal(
    @CurrentUser() user: any,
    @Param("proposalId") proposalId: string,
  ) {
    return this.aspirantsService.deleteProposal(Number(proposalId), user.id);
  }

  @Post("proposals/:proposalId/support")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Citizen backs a specific proposal/idea" })
  @ApiParam({ name: "proposalId", type: "number", example: 12 })
  @ApiResponse({ status: 201, description: "Support recorded" })
  supportProposal(
    @CurrentUser() user: any,
    @Param("proposalId") proposalId: string,
  ) {
    return this.aspirantsService.supportProposal(Number(proposalId), user.id);
  }

  @Delete("proposals/:proposalId/support")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Citizen withdraws their support from a proposal/idea",
  })
  @ApiParam({ name: "proposalId", type: "number", example: 12 })
  unsupportProposal(
    @CurrentUser() user: any,
    @Param("proposalId") proposalId: string,
  ) {
    return this.aspirantsService.unsupportProposal(
      Number(proposalId),
      user.id,
    );
  }

  @Patch(":id/approve")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Approve an aspirant (admin only)" })
  @ApiParam({
    name: "id",
    type: "number",
    description: "Aspirant ID",
    example: 5,
  })
  @ApiResponse({ status: 200, description: "Aspirant approved successfully" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Admin role required" })
  @ApiResponse({ status: 404, description: "Aspirant not found" })
  approve(@Param("id") id: number) {
    return this.aspirantsService.approve(Number(id));
  }
}
