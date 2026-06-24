import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
  Query,
  UseInterceptors,
} from "@nestjs/common";
import { CacheInterceptor, CacheTTL } from "@nestjs/cache-manager";
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
import { WardsService } from "./wards.service";
import { CreateWardDto } from "./dto/create-ward.dto";
import { GetWardsDto } from "./dto/get-wards.dto";

@ApiTags("Wards")
@Controller("wards")
export class WardsController {
  constructor(private readonly wardsService: WardsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Create a new ward (admin only)" })
  @ApiResponse({ status: 201, description: "Ward created successfully" })
  @ApiResponse({ status: 400, description: "Validation error" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  create(@Body() dto: CreateWardDto) {
    return this.wardsService.create(dto);
  }

  @Get()
  @ApiOperation({
    summary: "Get wards (optionally filter by state, parliamentary, assembly)",
  })
  @ApiQuery({
    name: "state",
    required: false,
    description: "State name to filter",
    example: "Karnataka",
  })
  @ApiQuery({
    name: "parliamentary",
    required: false,
    description: "Parliamentary constituency to filter",
    example: "Bangalore South",
  })
  @ApiQuery({
    name: "assembly",
    required: false,
    description: "Assembly constituency to filter",
    example: "Jayanagar",
  })
  @ApiResponse({ status: 200, description: "Wards returned successfully" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  findAll(@Query() query: GetWardsDto) {
    return this.wardsService.findAll(query);
  }

  @Get("list")
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(600_000)
  @ApiOperation({ summary: "Get simple list of wards (number and name)" })
  @ApiResponse({ status: 200, description: "List returned successfully" })
  listSimple() {
    return this.wardsService.listSimple();
  }

  @Get("by-voters")
  @ApiOperation({ summary: "Get wards ordered by number of voters (desc)" })
  @ApiResponse({
    status: 200,
    description: "Wards returned successfully ordered by voter count",
  })
  listByVoters() {
    return this.wardsService.listByVoterCount();
  }

  @Get("search")
  @ApiOperation({ summary: "Search wards by name or number (public)" })
  @ApiQuery({
    name: "q",
    required: false,
    description: "Search term matching ward name or number",
  })
  @ApiResponse({
    status: 200,
    description: "Matching wards returned with id, name, number, category",
  })
  searchWards(@Query("q") q?: string) {
    return this.wardsService.search(q);
  }

  @Get(":id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get a ward by ID" })
  @ApiParam({ name: "id", type: "number", description: "Ward ID", example: 1 })
  @ApiResponse({ status: 200, description: "Ward returned successfully" })
  @ApiResponse({ status: 404, description: "Ward not found" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  findOne(@Param("id") id: number) {
    return this.wardsService.findOne(Number(id));
  }

  @Get(":wardId/meetings")
  @ApiOperation({ summary: "Get active meetings for a specific ward" })
  @ApiParam({ name: "wardId", type: "number", description: "Ward ID" })
  @ApiResponse({ status: 200, description: "Meetings returned successfully" })
  getWardMeetings(@Param("wardId") wardId: string) {
    return this.wardsService.getActiveMeetingsByWard(+wardId);
  }

  // (Telegram group link API removed)
}
