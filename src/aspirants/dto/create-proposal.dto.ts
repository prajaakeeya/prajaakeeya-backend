import { IsNotEmpty, IsString } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class CreateProposalDto {
  @ApiProperty({
    description: "Short title for the project/idea",
    example: "Pothole reporting via public RTI road-maintenance data",
  })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty({
    description:
      "Markdown-formatted action plan: what you'll do, citing publicly " +
      "available data/documents, and how it's achievable with no or minimal " +
      "government funding.",
    example:
      "## What\nCross-reference RTI road-maintenance records with citizen complaints...\n\n## Cost\nZero-fund — uses existing public data portals.",
  })
  @IsString()
  @IsNotEmpty()
  details!: string;
}
