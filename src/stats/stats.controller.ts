import { Controller, Get, Query, UseInterceptors } from "@nestjs/common";
import { CacheInterceptor, CacheTTL } from "@nestjs/cache-manager";
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Public } from "../common/decorators/public.decorator";
import { StatsService } from "./stats.service";

@ApiTags("Stats")
@Controller("stats")
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get("citizens")
  @Public()
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(60_000)
  @ApiOperation({
    summary:
      "Public — total number of registered citizens (voters + aspirants)",
  })
  @ApiResponse({ status: 200, description: "Citizen count returned" })
  countCitizens() {
    return this.statsService.countCitizens();
  }

  @Get("constituency")
  @Public()
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(60_000)
  @ApiOperation({
    summary:
      "Public — total voters and aspirants registered to an election constituency",
    description:
      "Voter count = users whose saved constituency (POST /users/me/constituencies) matches the given electionId+constituencyId. Aspirant count = active aspirants who have agreed to SOP and uploaded a selfie.",
  })
  @ApiQuery({ name: "electionId", required: true, type: Number })
  @ApiQuery({ name: "constituencyId", required: true, type: Number })
  @ApiResponse({ status: 200, description: "Stats returned" })
  @ApiResponse({ status: 404, description: "Election not found" })
  findStatsByConstituency(
    @Query("electionId") electionId: string,
    @Query("constituencyId") constituencyId: string,
  ) {
    return this.statsService.findStatsByConstituency(
      Number(electionId),
      Number(constituencyId),
    );
  }
}
