import { IsString, Matches } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class AspirantSendOtpDto {
  @ApiProperty({ description: "10-digit mobile number", example: "9876543210" })
  @IsString()
  @Matches(/^(?!(\d)\1{9})(?!9876543210)[6-9]\d{9}$/, {
  message: "Phone number must be a valid 10-digit mobile number and cannot be a common dummy pattern",
})
  mobileNumber!: string;
}
