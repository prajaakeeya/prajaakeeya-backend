import { IsEnum, IsOptional } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { UpdateUserDto } from "./update-user.dto";

// Admin-only fields that must never be settable through the self-service
// `PATCH /users/me` flow. Kept separate from UpdateUserDto so `role` /
// `isBlocked` can only be assigned via the admin-guarded endpoint.
export class AdminUpdateUserDto extends UpdateUserDto {
  @ApiProperty({
    description: "User role",
    enum: ["voter", "aspirant", "admin"],
    example: "voter",
    required: false,
  })
  @IsEnum(["voter", "aspirant", "admin"])
  @IsOptional()
  role?: "voter" | "aspirant" | "admin";

  @ApiProperty({
    description: "Block status",
    example: false,
    required: false,
  })
  @IsOptional()
  isBlocked?: boolean;
}
