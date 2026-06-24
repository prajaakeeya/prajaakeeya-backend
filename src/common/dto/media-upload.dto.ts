import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";

export class UploadAspirantDocumentDto {
  @ApiProperty({
    description: "Type of document",
    enum: ["sop", "recent_photo", "selfie"],
    example: "sop",
  })
  @IsEnum(["sop", "recent_photo", "selfie"])
  @IsNotEmpty()
  documentType!: string;
}

export class VerifyDocumentDto {
  @ApiProperty({
    description: "Verification status",
    enum: ["verified", "rejected"],
    example: "verified",
  })
  @IsEnum(["verified", "rejected"])
  @IsNotEmpty()
  status!: "verified" | "rejected";

  @ApiPropertyOptional({
    description: "Reason for rejection (required if status is rejected)",
    example: "Document is not clear",
  })
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}

export class UploadAdminDocumentDto {
  @ApiProperty({
    description: "Type of global document",
    enum: [
      "sop",
      "sop_kannada",
      "agreement",
      "property_declaration",
      "code_of_conduct",
    ],
    example: "sop",
  })
  @IsEnum([
    "sop",
    "sop_kannada",
    "agreement",
    "property_declaration",
    "code_of_conduct",
  ])
  @IsNotEmpty()
  documentType!: string;

  @ApiPropertyOptional({
    description: "Document version",
    example: "v1.0",
  })
  @IsOptional()
  @IsString()
  version?: string;

  @ApiPropertyOptional({
    description: "Document description",
    example: "Updated terms for 2025",
  })
  @IsOptional()
  @IsString()
  description?: string;
}

export class SignDocumentDto {
  @ApiProperty({
    description: "ID of the admin document to sign",
    example: 1,
  })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  adminDocumentId!: number;
}
