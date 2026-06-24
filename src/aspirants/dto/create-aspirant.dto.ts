import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsString,
  IsOptional,
  Matches,
  ValidateIf,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";

export class CreateAspirantDto {
  @ApiProperty({
    description: "Name of the aspirant",
    example: "Priya Sharma",
  })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({
    description:
      "ID of the election type (from GET /elections). Optional at registration — " +
      "an aspirant can register before any election is announced and declare " +
      "their candidacy later via PATCH /aspirants/:id/candidacy.",
    example: 1,
  })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  electionId?: number;

  @ApiPropertyOptional({
    description:
      "ID of the constituency within that election (parliamentary/assembly/ward ID " +
      "from GET /elections/:type/constituencies). Optional — see electionId.",
    example: 5,
  })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  constituencyId?: number;

  @ApiPropertyOptional({
    description: "Party name (defaults to Independent)",
    example: "Independent",
    default: "Independent",
  })
  @IsString()
  @IsOptional()
  party?: string;

  @ApiPropertyOptional({
    description: "Age of the aspirant",
    example: 45,
  })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  age?: number;

  @ApiPropertyOptional({
    description: "Gender of the aspirant",
    example: "Male",
  })
  @IsString()
  @IsOptional()
  gender?: string;

  @ApiPropertyOptional({
    description: "Highest education qualification",
    example: "M.A. Public Administration",
  })
  @IsString()
  @IsOptional()
  education?: string;

  @ApiPropertyOptional({
    description: "Occupation or profession",
    example: "Social activist",
  })
  @IsString()
  @IsOptional()
  occupation?: string;

  @ApiPropertyOptional({
    description: "Phone number of the aspirant",
    example: "9876543210",
    pattern: "^[6-9]\\d{9}$",
  })
  @IsString()
  @IsOptional()
  @ValidateIf((o) => o.phone !== "" && o.phone != null)
  @Matches(/^[6-9]\d{9}$/, {
    message: "phone must be a valid 10-digit Indian mobile number",
  })
  phone?: string;

  @ApiPropertyOptional({
    description: "Postal or residential address of the aspirant",
    example: "123 MG Road, Ward 42, Bengaluru, Karnataka",
  })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiProperty({
    description: "Manifesto or campaign message",
    example: "Better roads and clean water for all",
  })
  @IsString()
  @IsNotEmpty()
  manifesto!: string;

  @ApiPropertyOptional({
    description: "Instagram profile link",
    example: "https://instagram.com/priyasharma",
  })
  @IsString()
  @IsOptional()
  instagramLink?: string;

  @ApiPropertyOptional({
    description: "Facebook profile link",
    example: "https://facebook.com/priyasharma",
  })
  @IsString()
  @IsOptional()
  facebookLink?: string;

  @ApiPropertyOptional({
    description: "LinkedIn profile link",
    example: "https://linkedin.com/in/priyasharma",
  })
  @IsString()
  @IsOptional()
  linkedinLink?: string;

  @ApiPropertyOptional({
    description: "Twitter/X profile link",
    example: "https://twitter.com/priyasharma",
  })
  @IsString()
  @IsOptional()
  twitterLink?: string;

  @ApiPropertyOptional({
    description: "WhatsApp number of the aspirant",
    example: "9876543210",
    pattern: "^[6-9]\\d{9}$",
  })
  @IsString()
  @IsOptional()
  @ValidateIf((o) => o.whatsappNumber !== "" && o.whatsappNumber != null)
  @Matches(/^[6-9]\d{9}$/, {
    message: "whatsappNumber must be a valid 10-digit Indian mobile number",
  })
  whatsappNumber?: string;

  @ApiPropertyOptional({
    description:
      "Electronic agreement to the Standard Operating Procedure. Replaces the legacy SOP file upload. Pass true once the aspirant has agreed; defaults to false.",
    example: true,
    default: false,
  })
  @Type(() => Boolean)
  @IsBoolean()
  @IsOptional()
  sopAgreed?: boolean;
}
