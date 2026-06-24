import { IsInt, IsNotEmpty } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";

export class DeclareCandidacyDto {
  @ApiProperty({
    description: "ID of the election type (from GET /elections)",
    example: 1,
  })
  @Type(() => Number)
  @IsInt()
  @IsNotEmpty()
  electionId!: number;

  @ApiProperty({
    description:
      "ID of the constituency within that election (parliamentary/assembly/ward ID from GET /elections/:type/constituencies)",
    example: 5,
  })
  @Type(() => Number)
  @IsInt()
  @IsNotEmpty()
  constituencyId!: number;
}
