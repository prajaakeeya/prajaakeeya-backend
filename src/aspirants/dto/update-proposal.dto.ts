import { IsOptional, IsString } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class UpdateProposalDto {
  @ApiPropertyOptional({ example: "Pothole reporting via public RTI road-maintenance data" })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ example: "## What\nUpdated plan details..." })
  @IsString()
  @IsOptional()
  details?: string;
}
