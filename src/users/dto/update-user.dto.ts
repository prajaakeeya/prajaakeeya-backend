import { IsString, IsOptional, IsNumber } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";

export class UpdateUserDto {
  @ApiProperty({
    description: "User name",
    example: "John Doe",
    required: false,
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({
    description: "Phone number",
    example: "+911234567890",
    required: false,
  })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({
    description: "Relative name",
    example: "Father Name",
    required: false,
  })
  @IsString()
  @IsOptional()
  relativeName?: string;

  @ApiProperty({
    description: "EPIC ID",
    example: "ABC1234567",
    required: false,
  })
  @IsString()
  @IsOptional()
  epicId?: string;

  @ApiProperty({
    description: "Gender",
    example: "Male",
    required: false,
  })
  @IsString()
  @IsOptional()
  gender?: string;

  @ApiProperty({
    description: "Age",
    example: 30,
    required: false,
  })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  age?: number;

  @ApiProperty({
    description: "Ward ID",
    example: 42,
    required: false,
  })
  @IsNumber()
  @IsOptional()
  wardId?: number;

  @ApiProperty({
    description: "Profile picture URL",
    example: "https://s3.amazonaws.com/bucket/profile.jpg",
    required: false,
  })
  @IsString()
  @IsOptional()
  profilePicture?: string;

  @ApiProperty({
    description: "Lok Sabha (parliamentary) constituency ID",
    example: 12,
    required: false,
  })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  lokSabhaConstituencyId?: number;

  @ApiProperty({
    description: "State Assembly constituency ID",
    example: 153,
    required: false,
  })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  stateAssemblyConstituencyId?: number;

  @ApiProperty({
    description: "Municipal Corporation constituency ID (ward ID)",
    example: 42,
    required: false,
  })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  municipalCorporationConstituencyId?: number;

  @ApiProperty({
    description: "Gram Panchayat constituency ID (village sr_no)",
    example: 1057,
    required: false,
  })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  gramPanchayatConstituencyId?: number;
}
