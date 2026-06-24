import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
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
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { AdminService } from "./admin.service";
import { AuditLogService } from "./audit-log.service";
import { UpdateReportStatusDto } from "../users/dto/update-report-status.dto";
import { UpdateUserDto } from "../users/dto/update-user.dto";
import { CreateWardMeetingDto } from "../wards/dto/create-ward-meeting.dto";
import { UpdateWardMeetingDto } from "../wards/dto/update-ward-meeting.dto";
import { SetVotingWindowDto } from "../votes/dto/set-voting-window.dto";
import { CreateElectionDto } from "../elections/dto/create-election.dto";
import { UpdateElectionDto } from "../elections/dto/update-election.dto";
import { CreateParliamentaryDto } from "../geography/dto/create-parliamentary.dto";
import { CreateAssemblyDto } from "../geography/dto/create-assembly.dto";
import { CreateMunicipalityDto } from "../geography/dto/create-municipality.dto";
import { CreateWardDto } from "../wards/dto/create-ward.dto";
import { CreateGramaPanchayatDto } from "../grama-panchayat/dto/create-grama-panchayat.dto";

@ApiTags("Admin")
@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin")
@ApiBearerAuth()
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get("dashboard")
  @ApiOperation({ summary: "Get admin dashboard statistics" })
  @ApiResponse({
    status: 200,
    description: "Dashboard data returned successfully",
  })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  dashboard() {
    return this.adminService.dashboard();
  }

  @Get("reports")
  @ApiOperation({ summary: "Get all reports submitted by users" })
  @ApiQuery({
    name: "status",
    required: false,
    enum: ["pending", "resolved", "rejected"],
    description: "Filter reports by status",
  })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiResponse({ status: 200, description: "Reports returned successfully" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  getAllReports(
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.adminService.getAllReports(
      status,
      page ? Number(page) : undefined,
      limit ? Number(limit) : undefined,
    );
  }

  @Get("reports/:id")
  @ApiOperation({ summary: "Get a specific report by ID" })
  @ApiParam({ name: "id", type: "number", description: "Report ID" })
  @ApiResponse({ status: 200, description: "Report returned successfully" })
  @ApiResponse({ status: 404, description: "Report not found" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  getReportById(@Param("id") id: string) {
    return this.adminService.getReportById(+id);
  }

  @Patch("reports/:id/status")
  @ApiOperation({ summary: "Update the status of a report" })
  @ApiParam({ name: "id", type: "number", description: "Report ID" })
  @ApiResponse({
    status: 200,
    description: "Report status updated successfully",
  })
  @ApiResponse({ status: 404, description: "Report not found" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async updateReportStatus(
    @Param("id") id: string,
    @Body() updateReportStatusDto: UpdateReportStatusDto,
    @Req() req: any,
  ) {
    const adminId = req.user?.id;
    const result = await this.adminService.updateReportStatus(
      +id,
      updateReportStatusDto.status,
      updateReportStatusDto.adminNotes,
      adminId,
    );
    await this.auditLog.log({
      adminId,
      adminEmail: req.user?.email,
      action: "update_report_status",
      resource: "report",
      resourceId: +id,
      metadata: { status: updateReportStatusDto.status },
    });
    return result;
  }

  // User Management Endpoints
  @Get("users")
  @ApiOperation({ summary: "Get all users (paginated)" })
  @ApiQuery({ name: "page", required: false, type: Number, description: "Page number (default 1)" })
  @ApiQuery({ name: "limit", required: false, type: Number, description: "Items per page (default 50, max 200)" })
  @ApiQuery({ name: "search", required: false, type: String, description: "Search by name" })
  @ApiResponse({ status: 200, description: "Users returned successfully" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  getAllUsers(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("search") search?: string,
  ) {
    return this.adminService.getAllUsers(
      page ? Number(page) : undefined,
      limit ? Number(limit) : undefined,
      search,
    );
  }

  @Get("users/:id")
  @ApiOperation({ summary: "Get a specific user by ID" })
  @ApiParam({ name: "id", type: "number", description: "User ID" })
  @ApiResponse({ status: 200, description: "User returned successfully" })
  @ApiResponse({ status: 404, description: "User not found" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  getUserById(@Param("id") id: string) {
    return this.adminService.getUserById(+id);
  }

  @Patch("users/:id")
  @ApiOperation({ summary: "Update user details" })
  @ApiParam({ name: "id", type: "number", description: "User ID" })
  @ApiResponse({ status: 200, description: "User updated successfully" })
  @ApiResponse({ status: 404, description: "User not found" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  updateUser(@Param("id") id: string, @Body() dto: UpdateUserDto) {
    return this.adminService.updateUser(+id, dto);
  }

  // @Patch("users/:id/block")
  // @ApiOperation({ summary: "Block a user" })
  // @ApiParam({ name: "id", type: "number", description: "User ID" })
  // @ApiResponse({ status: 200, description: "User blocked successfully" })
  // @ApiResponse({ status: 404, description: "User not found" })
  // @ApiResponse({ status: 401, description: "Unauthorized" })
  // blockUser(@Param("id") id: string) {
  //   return this.adminService.blockUser(+id);
  // }

  @Patch("users/:id/unblock")
  @ApiOperation({ summary: "Unblock a user" })
  @ApiParam({ name: "id", type: "number", description: "User ID" })
  @ApiResponse({ status: 200, description: "User unblocked successfully" })
  @ApiResponse({ status: 404, description: "User not found" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async unblockUser(@Param("id") id: string, @Req() req: any) {
    const result = await this.adminService.unblockUser(+id);
    await this.auditLog.log({
      adminId: req.user?.id,
      adminEmail: req.user?.email,
      action: "unblock_user",
      resource: "user",
      resourceId: +id,
    });
    return result;
  }

  // @Delete("users/:id")
  // @ApiOperation({ summary: "Delete a user" })
  // @ApiParam({ name: "id", type: "number", description: "User ID" })
  // @ApiResponse({ status: 200, description: "User deleted successfully" })
  // @ApiResponse({ status: 404, description: "User not found" })
  // @ApiResponse({ status: 401, description: "Unauthorized" })
  // deleteUser(@Param("id") id: string) {
  //   return this.adminService.deleteUser(+id);
  // }

  @Get("wards/:wardId/users")
  @ApiOperation({ summary: "Get all users in a specific ward" })
  @ApiParam({ name: "wardId", type: "number", description: "Ward ID" })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiResponse({ status: 200, description: "Users returned successfully" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  getUsersByWard(
    @Param("wardId") wardId: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.adminService.getUsersByWard(
      +wardId,
      page ? Number(page) : undefined,
      limit ? Number(limit) : undefined,
    );
  }

  // Ward Meeting Management Endpoints
  @Post("meetings")
  @ApiOperation({ summary: "Create a new ward meeting link" })
  @ApiResponse({ status: 201, description: "Meeting created successfully" })
  @ApiResponse({ status: 404, description: "Ward not found" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  createMeeting(@Body() dto: CreateWardMeetingDto, @Req() req: any) {
    const adminId = req.user?.id;
    return this.adminService.createMeeting(dto, adminId);
  }

  @Get("meetings")
  @ApiOperation({ summary: "Get all ward meetings" })
  @ApiQuery({
    name: "wardNumber",
    required: false,
    type: "string",
    description: "Filter by ward number",
  })
  @ApiQuery({
    name: "isActive",
    required: false,
    type: "boolean",
    description: "Filter by active status",
  })
  @ApiResponse({ status: 200, description: "Meetings returned successfully" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  getAllMeetings(
    @Query("wardNumber") wardNumber?: string,
    @Query("isActive") isActive?: string,
  ) {
    return this.adminService.getAllMeetings(
      wardNumber,
      isActive !== undefined ? isActive === "true" : undefined,
    );
  }

  @Get("meetings/:id")
  @ApiOperation({ summary: "Get a specific meeting by ID" })
  @ApiParam({ name: "id", type: "number", description: "Meeting ID" })
  @ApiResponse({ status: 200, description: "Meeting returned successfully" })
  @ApiResponse({ status: 404, description: "Meeting not found" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  getMeetingById(@Param("id") id: string) {
    return this.adminService.getMeetingById(+id);
  }

  @Patch("meetings/:id")
  @ApiOperation({ summary: "Update a ward meeting" })
  @ApiParam({ name: "id", type: "number", description: "Meeting ID" })
  @ApiResponse({ status: 200, description: "Meeting updated successfully" })
  @ApiResponse({ status: 404, description: "Meeting not found" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  updateMeeting(@Param("id") id: string, @Body() dto: UpdateWardMeetingDto) {
    return this.adminService.updateMeeting(+id, dto);
  }

  // @Delete("meetings/:id")
  // @ApiOperation({ summary: "Delete a ward meeting" })
  // @ApiParam({ name: "id", type: "number", description: "Meeting ID" })
  // @ApiResponse({ status: 200, description: "Meeting deleted successfully" })
  // @ApiResponse({ status: 404, description: "Meeting not found" })
  // @ApiResponse({ status: 401, description: "Unauthorized" })
  // deleteMeeting(@Param("id") id: string) {
  //   return this.adminService.deleteMeeting(+id);
  // }

  // Election Management
  @Post("elections")
  @ApiOperation({ summary: "Create a new election type" })
  @ApiResponse({ status: 201, description: "Election created" })
  async createElection(@Body() dto: CreateElectionDto, @Req() req: any) {
    const result = await this.adminService.createElection(dto);
    await this.auditLog.log({
      adminId: req.user?.id,
      adminEmail: req.user?.email,
      action: "create_election",
      resource: "election",
      resourceId: (result as any)?.id,
      metadata: { name: dto.name, type: (dto as any).type },
    });
    return result;
  }

  @Patch("elections/:id")
  @ApiOperation({ summary: "Update an election" })
  @ApiParam({ name: "id", type: "number" })
  @ApiResponse({ status: 200, description: "Election updated" })
  @ApiResponse({ status: 404, description: "Election not found" })
  async updateElection(@Param("id") id: string, @Body() dto: UpdateElectionDto, @Req() req: any) {
    const result = await this.adminService.updateElection(+id, dto);
    await this.auditLog.log({
      adminId: req.user?.id,
      adminEmail: req.user?.email,
      action: "update_election",
      resource: "election",
      resourceId: +id,
      metadata: dto as any,
    });
    return result;
  }

  // @Delete("elections/:id")
  // @ApiOperation({ summary: "Delete an election" })
  // @ApiParam({ name: "id", type: "number" })
  // @ApiResponse({ status: 200, description: "Election deleted" })
  // @ApiResponse({ status: 404, description: "Election not found" })
  // deleteElection(@Param("id") id: string) {
  //   return this.adminService.deleteElection(+id);
  // }

  // Parliamentary Constituency Management
  @Post("parliamentary")
  @ApiOperation({ summary: "Create a parliamentary constituency" })
  @ApiResponse({
    status: 201,
    description: "Parliamentary constituency created",
  })
  createParliamentary(@Body() dto: CreateParliamentaryDto) {
    return this.adminService.createParliamentary(dto);
  }

  @Patch("parliamentary/:id")
  @ApiOperation({ summary: "Update a parliamentary constituency" })
  @ApiParam({ name: "id", type: "number" })
  @ApiResponse({
    status: 200,
    description: "Parliamentary constituency updated",
  })
  @ApiResponse({ status: 404, description: "Not found" })
  updateParliamentary(
    @Param("id") id: string,
    @Body() dto: CreateParliamentaryDto,
  ) {
    return this.adminService.updateParliamentary(+id, dto);
  }

  // @Delete("parliamentary/:id")
  // @ApiOperation({ summary: "Delete a parliamentary constituency" })
  // @ApiParam({ name: "id", type: "number" })
  // @ApiResponse({ status: 200, description: "Deleted" })
  // @ApiResponse({ status: 404, description: "Not found" })
  // deleteParliamentary(@Param("id") id: string) {
  //   return this.adminService.deleteParliamentary(+id);
  // }

  // Assembly Constituency Management
  @Post("assembly")
  @ApiOperation({ summary: "Create an assembly constituency" })
  @ApiResponse({ status: 201, description: "Assembly constituency created" })
  createAssembly(@Body() dto: CreateAssemblyDto) {
    return this.adminService.createAssembly(dto);
  }

  @Patch("assembly/:id")
  @ApiOperation({ summary: "Update an assembly constituency" })
  @ApiParam({ name: "id", type: "number" })
  @ApiResponse({ status: 200, description: "Assembly constituency updated" })
  @ApiResponse({ status: 404, description: "Not found" })
  updateAssembly(@Param("id") id: string, @Body() dto: CreateAssemblyDto) {
    return this.adminService.updateAssembly(+id, dto);
  }

  // @Delete("assembly/:id")
  // @ApiOperation({ summary: "Delete an assembly constituency" })
  // @ApiParam({ name: "id", type: "number" })
  // @ApiResponse({ status: 200, description: "Deleted" })
  // @ApiResponse({ status: 404, description: "Not found" })
  // deleteAssembly(@Param("id") id: string) {
  //   return this.adminService.deleteAssembly(+id);
  // }

  // Municipality / City Corporation Management
  @Get("municipalities")
  @ApiOperation({ summary: "List all city corporations / municipalities" })
  @ApiQuery({
    name: "state",
    required: false,
    type: "string",
    description: "Filter by state",
  })
  @ApiResponse({ status: 200, description: "List returned" })
  getMunicipalities(@Query("state") state?: string) {
    return this.adminService.getMunicipalities(state);
  }

  @Post("municipalities")
  @ApiOperation({ summary: "Add a new city corporation / municipality" })
  @ApiResponse({ status: 201, description: "Municipality created" })
  @ApiResponse({ status: 409, description: "Already exists" })
  createMunicipality(@Body() dto: CreateMunicipalityDto) {
    return this.adminService.createMunicipality(dto);
  }

  @Patch("municipalities/:id")
  @ApiOperation({ summary: "Update a municipality" })
  @ApiParam({ name: "id", type: "number" })
  @ApiResponse({ status: 200, description: "Municipality updated" })
  @ApiResponse({ status: 404, description: "Not found" })
  updateMunicipality(
    @Param("id") id: string,
    @Body() dto: CreateMunicipalityDto,
  ) {
    return this.adminService.updateMunicipality(+id, dto);
  }

  // @Delete("municipalities/:id")
  // @ApiOperation({ summary: "Delete a municipality" })
  // @ApiParam({ name: "id", type: "number" })
  // @ApiResponse({ status: 200, description: "Deleted" })
  // @ApiResponse({ status: 404, description: "Not found" })
  // deleteMunicipality(@Param("id") id: string) {
  //   return this.adminService.deleteMunicipality(+id);
  // }

  // Ward Management
  @Post("wards")
  @ApiOperation({ summary: "Create a ward" })
  @ApiResponse({ status: 201, description: "Ward created" })
  createWard(@Body() dto: CreateWardDto) {
    return this.adminService.createWard(dto);
  }

  @Patch("wards/:id")
  @ApiOperation({ summary: "Update a ward" })
  @ApiParam({ name: "id", type: "number" })
  @ApiResponse({ status: 200, description: "Ward updated" })
  @ApiResponse({ status: 404, description: "Not found" })
  updateWard(@Param("id") id: string, @Body() dto: CreateWardDto) {
    return this.adminService.updateWard(+id, dto);
  }

  // @Delete("wards/:id")
  // @ApiOperation({ summary: "Delete a ward" })
  // @ApiParam({ name: "id", type: "number" })
  // @ApiResponse({ status: 200, description: "Ward deleted" })
  // @ApiResponse({ status: 404, description: "Not found" })
  // deleteWard(@Param("id") id: string) {
  //   return this.adminService.deleteWard(+id);
  // }

  // Grama Panchayat Management
  @Post("grama-panchayat")
  @ApiOperation({ summary: "Add a village to grama panchayat table" })
  @ApiResponse({ status: 201, description: "Village created" })
  createGramaPanchayat(@Body() dto: CreateGramaPanchayatDto) {
    return this.adminService.createGramaPanchayat(dto);
  }

  @Patch("grama-panchayat/:id")
  @ApiOperation({ summary: "Update a grama panchayat village entry" })
  @ApiParam({ name: "id", type: "number", description: "Sr.No of the village" })
  @ApiResponse({ status: 200, description: "Village updated" })
  @ApiResponse({ status: 404, description: "Not found" })
  updateGramaPanchayat(
    @Param("id") id: string,
    @Body() dto: CreateGramaPanchayatDto,
  ) {
    return this.adminService.updateGramaPanchayat(+id, dto);
  }

  // @Delete("grama-panchayat/:id")
  // @ApiOperation({ summary: "Delete a grama panchayat village entry" })
  // @ApiParam({ name: "id", type: "number", description: "Sr.No of the village" })
  // @ApiResponse({ status: 200, description: "Village deleted" })
  // @ApiResponse({ status: 404, description: "Not found" })
  // deleteGramaPanchayat(@Param("id") id: string) {
  //   return this.adminService.deleteGramaPanchayat(+id);
  // }

  // Voting Window Management
  @Post("voting-window")
  @ApiOperation({ summary: "Set the voting window with start and end times" })
  @ApiResponse({ status: 201, description: "Voting window set successfully" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async setVotingWindow(@Body() dto: SetVotingWindowDto, @Req() req: any) {
    const result = await this.adminService.setVotingWindow(dto);
    await this.auditLog.log({
      adminId: req.user?.id,
      adminEmail: req.user?.email,
      action: "set_voting_window",
      resource: "voting_window",
      resourceId: (result as any)?.id,
      metadata: { startTime: dto.startTime, endTime: dto.endTime, electionId: dto.electionId },
    });
    return result;
  }

  @Get("voting-window")
  @ApiOperation({ summary: "Get the active voting window" })
  @ApiResponse({
    status: 200,
    description: "Voting window returned successfully",
  })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  getActiveVotingWindow() {
    return this.adminService.getActiveVotingWindow();
  }

  @Get("voting-windows")
  @ApiOperation({ summary: "Get all voting windows (historical)" })
  @ApiResponse({
    status: 200,
    description: "Voting windows returned successfully",
  })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  getAllVotingWindows() {
    return this.adminService.getAllVotingWindows();
  }

  // Audit Log
  @Get("audit-logs")
  @ApiOperation({ summary: "Get admin audit log (paginated)" })
  @ApiQuery({ name: "adminId", required: false, type: Number })
  @ApiQuery({ name: "action", required: false, type: String })
  @ApiQuery({ name: "resource", required: false, type: String })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiResponse({ status: 200, description: "Audit logs returned" })
  getAuditLogs(
    @Query("adminId") adminId?: string,
    @Query("action") action?: string,
    @Query("resource") resource?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.auditLog.findAll({
      adminId: adminId ? Number(adminId) : undefined,
      action,
      resource,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
