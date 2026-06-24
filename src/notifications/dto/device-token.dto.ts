import { IsOptional, IsString, MaxLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class RegisterDeviceTokenDto {
  @ApiProperty({
    description: "FCM registration token from the web client (getToken)",
  })
  @IsString()
  token!: string;

  @ApiProperty({
    description: "Optional platform label (e.g. web, pwa, android-twa)",
    required: false,
    example: "web",
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  platform?: string;
}

export class RemoveDeviceTokenDto {
  @ApiProperty({
    description: "FCM registration token to remove (e.g. on logout)",
  })
  @IsString()
  token!: string;
}
