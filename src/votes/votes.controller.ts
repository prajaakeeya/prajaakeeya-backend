import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { Public } from "../common/decorators/public.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../common/decorators/current-user.decorator";
import { VotesService } from "./votes.service";
import { CastVoteDto } from "./dto/cast-vote.dto";

@ApiTags("Votes")
@Controller("vote")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class VotesController {
  constructor(private readonly votesService: VotesService) {}

  @Post()
  // Strict rate limit on vote endpoint: 5 per minute (configurable via VOTE_THROTTLE_LIMIT env var)
  // Set VOTE_THROTTLE_SKIP=true to disable for testing
  @Throttle({
    default: {
      ttl: 60000,
      limit: parseInt(process.env.VOTE_THROTTLE_LIMIT || "5"),
    },
  })
  @ApiOperation({ summary: "Cast a vote for an aspirant" })
  @ApiResponse({ status: 201, description: "Vote cast successfully" })
  @ApiResponse({
    status: 400,
    description: "Already voted or validation failed",
  })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({
    status: 429,
    description: "Too many requests — rate limit exceeded",
  })
  castVote(@CurrentUser() user: AuthUser, @Body() dto: CastVoteDto) {
    return this.votesService.castVote(user.id, dto);
  }

  @Get("ward/:wardId")
  @ApiOperation({ summary: "Get voting results for a ward" })
  @ApiParam({
    name: "wardId",
    type: "number",
    description: "Ward ID",
    example: 1,
  })
  @ApiResponse({ status: 200, description: "Results returned successfully" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async results(@Param("wardId") wardId: number) {
    const rows = await this.votesService.wardResults(Number(wardId));
    const total = rows.reduce(
      (acc: number, r: { totalVotes?: number | string }) =>
        acc + Number(r.totalVotes || 0),
      0,
    );
    return { results: rows, totalVotes: total };
  }

  @Get("me/:wardId")
  @ApiOperation({ summary: "Get current user vote for a specific ward" })
  @ApiParam({
    name: "wardId",
    type: "number",
    description: "Ward ID",
    example: 1,
  })
  @ApiResponse({ status: 200, description: "Vote returned successfully" })
  @ApiResponse({ status: 404, description: "Vote not found" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  myVote(@CurrentUser() user: AuthUser, @Param("wardId") wardId: number) {
    return this.votesService.findUserVote(user.id, Number(wardId));
  }

  @Get("voting-window")
  @Public()
  @ApiOperation({
    summary:
      "Get the active voting window and check if voting is currently allowed",
  })
  @ApiResponse({
    status: 200,
    description: "Voting window information returned",
  })
  async getVotingWindowStatus() {
    const window = await this.votesService.getActiveVotingWindow();
    const isAllowed = await this.votesService.isVotingAllowed();

    return {
      window,
      isVotingAllowed: isAllowed,
      currentTime: new Date(),
    };
  }
}
