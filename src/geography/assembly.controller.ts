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
import { AssemblyService } from "./assembly.service";
import { CreateAssemblyDto } from "./dto/create-assembly.dto";

@ApiTags("Geography")
@Controller("geography/assembly")
@UseInterceptors(CacheInterceptor)
@CacheTTL(3600_000)
export class AssemblyController {
  constructor(private readonly assemblyService: AssemblyService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Create a new assembly constituency (admin only)" })
  @ApiResponse({
    status: 201,
    description: "Assembly constituency created successfully",
  })
  @ApiResponse({
    status: 409,
    description: "Assembly constituency already exists",
  })
  create(@Body() dto: CreateAssemblyDto) {
    return this.assemblyService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: "Get all assembly constituencies" })
  @ApiQuery({
    name: "state",
    required: false,
    description: "Filter by state name",
  })
  @ApiQuery({
    name: "parliamentary",
    required: false,
    description: "Filter by parliamentary constituency",
  })
  @ApiResponse({
    status: 200,
    description: "Assembly constituencies retrieved successfully",
  })
  getAll(
    @Query("state") state?: string,
    @Query("parliamentary") parliamentary?: string,
  ) {
    return this.assemblyService.findAll(state, parliamentary);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get an assembly constituency by ID" })
  @ApiParam({
    name: "id",
    type: "number",
    description: "Assembly constituency ID",
    example: 1,
  })
  @ApiResponse({
    status: 200,
    description: "Assembly constituency retrieved successfully",
  })
  @ApiResponse({ status: 404, description: "Assembly constituency not found" })
  getOne(@Param("id") id: string) {
    return this.assemblyService.findOne(Number(id));
  }
}
