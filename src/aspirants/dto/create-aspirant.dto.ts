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
  @Matches(/^(?!(\d)\1{9})(?!9876543210)[6-9]\d{9}$/, {
  message: "Phone number must be a valid 10-digit mobile number and cannot be a common dummy pattern",
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
      "Answer to Q1: Identity & Background (who you are, education/professional background, skills)",
    example:
      "Priya Sharma, M.A. Public Administration, 8 years NGO and civic tech experience.",
  })
  @IsString()
  @IsOptional()
  identityBackground?: string;

  @ApiPropertyOptional({
    description:
      "Answer to Q2: The Resignation Pledge (willingness to sign affidavit)",
    example: "Yes — I will sign a legal affidavit to resign if poll < 50%.",
  })
  @IsString()
  @IsOptional()
  resignationPledge?: string;

  @ApiPropertyOptional({
    description: "Answer to Q3: Financial Integrity (declare assets publicly)",
    example:
      "I will declare all family assets on the portal before primary selection.",
  })
  @IsString()
  @IsOptional()
  financialIntegrity?: string;

  @ApiPropertyOptional({
    description:
      "Answer to Q4: No High Command (which will you follow if party order conflicts with digital vote)",
    example: "I will follow the digital vote of the ward citizens.",
  })
  @IsString()
  @IsOptional()
  noHighCommand?: string;

  @ApiPropertyOptional({
    description:
      "Answer to Q5: Technical Competence (ensuring ABC costing verified by Expert Portal)",
    example:
      "All budgets will be submitted to Expert Portal for verification before polling.",
  })
  @IsString()
  @IsOptional()
  technicalCompetence?: string;

  @ApiPropertyOptional({
    description:
      "Answer to Q6: Transparency (upload bills/receipts/work-progress photos)",
    example:
      "I agree to upload every bill and receipt to the Live Ledger within 24 hours.",
  })
  @IsString()
  @IsOptional()
  transparency?: string;

  @ApiPropertyOptional({
    description:
      "Answer to Q7: Emergency Protocol (prove emergency decisions are unavoidable)",
    example:
      "I will publish a timestamped justification and notify experts and voters immediately.",
  })
  @IsString()
  @IsOptional()
  emergencyProtocol?: string;

  @ApiPropertyOptional({
    description:
      "Answer to Q8: Expert Consultation (commit to consult 3 registered experts for projects > ₹1 Lakh)",
    example:
      "Yes — will consult at least three registered experts for projects > ₹1 Lakh.",
  })
  @IsString()
  @IsOptional()
  expertConsultation?: string;

  @ApiPropertyOptional({
    description:
      "Answer to Q9: Voter Feedback (handling Correct/Reject of a plan)",
    example:
      "I will revise the plan and resubmit it for a corrective poll or accept majority rejection.",
  })
  @IsString()
  @IsOptional()
  voterFeedback?: string;

  @ApiPropertyOptional({
    description:
      "Answer to Q10: The Primary Rule (withdraw if lose Voter Primary Poll)",
    example:
      "Yes — I will withdraw my nomination and support the selected person.",
  })
  @IsString()
  @IsOptional()
  primaryRule?: string;

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
