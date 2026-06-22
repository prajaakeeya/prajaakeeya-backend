import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
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
import { ParliamentaryService } from "./parliamentary.service";
import { CreateParliamentaryDto } from "./dto/create-parliamentary.dto";

@ApiTags("Geography")
@Controller("geography/parliamentary")
@UseInterceptors(CacheInterceptor)
@CacheTTL(3600_000)
export class ParliamentaryController {
  constructor(private readonly parliamentaryService: ParliamentaryService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Create a new parliamentary constituency" })
  @ApiResponse({
    status: 201,
    description: "Parliamentary constituency created successfully",
  })
  @ApiResponse({
    status: 409,
    description: "Parliamentary constituency already exists",
  })
  create(@Body() dto: CreateParliamentaryDto) {
    return this.parliamentaryService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: "Get all parliamentary constituencies" })
  @ApiQuery({
    name: "state",
    required: false,
    description: "Filter by state name",
  })
  @ApiResponse({
    status: 200,
    description: "Parliamentary constituencies retrieved successfully",
  })
  getAll(@Query("state") state?: string) {
    return this.parliamentaryService.findAll(state);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a parliamentary constituency by ID" })
  @ApiParam({
    name: "id",
    type: "number",
    description: "Parliamentary constituency ID",
    example: 1,
  })
  @ApiResponse({
    status: 200,
    description: "Parliamentary constituency retrieved successfully",
  })
  @ApiResponse({
    status: 404,
    description: "Parliamentary constituency not found",
  })
  getOne(@Param("id") id: string) {
    return this.parliamentaryService.findOne(Number(id));
  }
}
