import {
  Body,
  Controller,
  Get,
  Post,
  Param,
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
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { GeographyService } from "./geography.service";
import { CreateStateDto } from "./dto/create-state.dto";

@ApiTags("Geography")
@Controller("geography")
@UseInterceptors(CacheInterceptor)
@CacheTTL(3600_000)
export class GeographyController {
  constructor(private readonly geographyService: GeographyService) {}

  @Post("states")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Create a new state" })
  @ApiResponse({ status: 201, description: "State created successfully" })
  @ApiResponse({ status: 409, description: "State already exists" })
  createState(@Body() dto: CreateStateDto) {
    return this.geographyService.createState(dto);
  }

  @Get("states")
  @ApiOperation({ summary: "Get all states" })
  @ApiResponse({ status: 200, description: "States retrieved successfully" })
  getAllStates() {
    return this.geographyService.findAllStates();
  }

  @Get("states/:id")
  @ApiOperation({ summary: "Get a state by ID" })
  @ApiParam({ name: "id", type: "number", description: "State ID", example: 1 })
  @ApiResponse({ status: 200, description: "State retrieved successfully" })
  @ApiResponse({ status: 404, description: "State not found" })
  getState(@Param("id") id: string) {
    return this.geographyService.findState(Number(id));
  }
}
