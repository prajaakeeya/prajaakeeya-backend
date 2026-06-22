import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiConsumes,
  ApiBody,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { VoterRollService } from "./voter-roll.service";
import { WardsService } from "../wards/wards.service";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import * as xlsx from "xlsx";
import { MAX_UPLOAD_BYTES } from "../common/upload.constants";

@ApiTags("Voter Roll")
@Controller("voters")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin")
export class VoterRollController {
  constructor(
    private readonly voterRollService: VoterRollService,
    private readonly wardsService: WardsService,
  ) {}

  @Get("ward/:wardId")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get all voters in a ward" })
  @ApiParam({
    name: "wardId",
    type: "number",
    description: "Ward ID",
    example: 1,
  })
  @ApiResponse({ status: 200, description: "Voters returned successfully" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  findByWard(@Param("wardId") wardId: number) {
    return this.voterRollService.findByWard(Number(wardId));
  }

  @Get("epic/:epic")
  @ApiOperation({ summary: "Find voter by EPIC number" })
  @ApiParam({
    name: "epic",
    type: "string",
    description: "EPIC ID",
    example: "ABC1234567",
  })
  @ApiResponse({ status: 200, description: "Voter found" })
  @ApiResponse({ status: 404, description: "Voter not found" })
  async findByEpic(@Param("epic") epic: string) {
    const voter = await this.voterRollService.findEpic(epic);
    if (!voter) return { wardName: null };
    const ward = await this.wardsService.findOne(voter.wardId);
    return { wardName: ward.name, wardId: ward.id };
  }

  @Get("ward")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get voter counts by ward" })
  @ApiResponse({
    status: 200,
    description: "Ward counts returned successfully",
  })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async wardCounts() {
    const counts = await this.voterRollService.wardCounts();
    const wards = await this.wardsService.findAll();
    return counts.map((count) => ({
      wardId: count.wardId,
      wardName: wards.find((w) => w.id === count.wardId)?.name || "Ward",
      wardNumber: wards.find((w) => w.id === count.wardId)?.number || null,
      total: count.total,
    }));
  }

  @Post("ward/:wardId/upload-excel")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Upload Excel file with voter data for a ward" })
  @ApiParam({
    name: "wardId",
    type: "number",
    description: "Ward ID",
    example: 1,
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          format: "binary",
          description: "Excel file (.xlsx or .xls)",
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: "Excel file uploaded and processed successfully",
  })
  @ApiResponse({ status: 400, description: "Invalid file or validation error" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
      fileFilter: (_req, file, cb) => {
        if (!file.originalname.match(/\.(xlsx|xls)$/i)) {
          return cb(
            new BadRequestException("Only Excel files are allowed"),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async uploadWardExcel(
    @Param("wardId") wardId: number,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException("Excel file is required");
    }

    const workbook = xlsx.read(file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json<Record<string, any>>(sheet, {
      defval: "",
    });

    const normalizeKey = (value: string) =>
      value
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");

    const columnAliases: Record<string, string> = {
      slno: "slNo",
      serialno: "slNo",
      sno: "slNo",
      sl_no: "slNo",
      votername: "name",
      name: "name",
      fatherorhusbandname: "relativeName",
      fathershusbandsname: "relativeName",
      fathershusbandname: "relativeName",
      fatherhusbandname: "relativeName",
      fathername: "relativeName",
      husbandname: "relativeName",
      relativename: "relativeName",
      age: "age",
      epicid: "epicNumber",
      epic: "epicNumber",
      epicnumber: "epicNumber",
      epic_id: "epicNumber",
      gender: "gender",
      sex: "gender",
    };

    const voters = rows
      .map((row) => {
        const normalized: Record<string, any> = {};
        Object.entries(row).forEach(([key, value]) => {
          const normalizedKeyString = normalizeKey(key);
          const normalizedKey = columnAliases[normalizedKeyString];
          if (normalizedKey) {
            normalized[normalizedKey] = value;
          }
        });

        if (
          !normalized.epicNumber ||
          !normalized.name ||
          !normalized.relativeName
        ) {
          return null;
        }

        return {
          slNo: normalized.slNo ? String(normalized.slNo).trim() : undefined,
          name: String(normalized.name).trim(),
          relativeName: String(normalized.relativeName).trim(),
          age: Number(normalized.age || 0),
          gender: String(normalized.gender || "").trim(),
          epicNumber: String(normalized.epicNumber).trim().toUpperCase(),
          wardId: Number(wardId),
          houseNo: "",
        };
      })
      .filter(Boolean);

    // Remove duplicates based on epicNumber (keep first occurrence)
    const seen = new Set<string>();
    const uniqueVoters = voters.filter((voter: any) => {
      if (seen.has(voter.epicNumber)) {
        return false;
      }
      seen.add(voter.epicNumber);
      return true;
    });

    await this.voterRollService.bulkInsert(uniqueVoters as any);
    return {
      wardId: Number(wardId),
      total: uniqueVoters.length,
      duplicatesRemoved: voters.length - uniqueVoters.length,
    };
  }
}
