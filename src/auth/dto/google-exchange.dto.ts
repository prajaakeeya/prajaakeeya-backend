import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

export class GoogleExchangeDto {
  @ApiProperty({ description: "One-time authorization code from the callback" })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty({ description: "OAuth state echoed back on the callback" })
  @IsString()
  @IsNotEmpty()
  state!: string;
}
