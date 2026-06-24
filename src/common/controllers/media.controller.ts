import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Req,
  Query,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiParam,
  ApiQuery,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../guards/jwt-auth.guard";
import { RolesGuard } from "../guards/roles.guard";
import { Roles } from "../decorators/roles.decorator";
import { CurrentUser } from "../decorators/current-user.decorator";
import { MediaService } from "../services/media.service";
import {
  UploadAspirantDocumentDto,
  VerifyDocumentDto,
  UploadAdminDocumentDto,
  SignDocumentDto,
} from "../dto/media-upload.dto";

@ApiTags("Media Upload")
@Controller("media")
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get("presign")
  @Roles("admin")
  @ApiOperation({ summary: "Get presigned URL for private S3 object (admin only)" })
  @ApiQuery({
    name: "key",
    description: "S3 object key (e.g. profiles/20/file.jpg)",
    required: true,
  })
  @ApiQuery({
    name: "expires",
    description: "Expiry in seconds (default 3600)",
    required: false,
  })
  @ApiResponse({ status: 200, description: "Presigned URL returned" })
  async getPresignedUrl(
    @Query("key") key: string,
    @Query("expires") expires?: string,
  ) {
    const exp = expires ? parseInt(expires, 10) : 3600;
    const url = await this.mediaService.getPresignedUrl(key, exp);
    return { url, expiresIn: exp };
  }

  // User profile picture
  @Post("profile-picture")
  @UseInterceptors(FileInterceptor("file"))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Upload or update user profile picture" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          format: "binary",
          description: "Profile picture file (max 10MB)",
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: "Profile picture uploaded successfully",
  })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async uploadProfilePicture(
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const userId = req.user.id;
    return await this.mediaService.uploadProfilePicture(userId, file);
  }

  @Delete("profile-picture")
  @ApiOperation({ summary: "Delete user profile picture" })
  @ApiResponse({
    status: 200,
    description: "Profile picture deleted successfully",
  })
  @ApiResponse({ status: 400, description: "No profile picture to delete" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async deleteProfilePicture(@Req() req: any) {
    return await this.mediaService.deleteProfilePicture(req.user.id);
  }

  // Aspirant document uploads
  @Post("aspirant/:aspirantId/document")
  @UseInterceptors(FileInterceptor("file"))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Upload aspirant document (SOP, Agreement, etc.)" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["documentType", "file"],
      properties: {
        documentType: {
          type: "string",
          enum: [
            "sop",
            "sop_kannada",
            "agreement",
            "property_declaration",
            "code_of_conduct",
            "resume",
            "epic_card",
            "epic_card_back",
            "address_proof",
            "recent_photo",
            "selfie",
          ],
          description: "Type of document being uploaded",
        },
        file: {
          type: "string",
          format: "binary",
          description: "Document file (max 10MB)",
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: "Document uploaded successfully" })
  @ApiResponse({ status: 404, description: "Aspirant not found" })
  async uploadAspirantDocument(
    @CurrentUser() user: any,
    @Param("aspirantId", ParseIntPipe) aspirantId: number,
    @Body() dto: UploadAspirantDocumentDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return await this.mediaService.uploadAspirantDocument(
      aspirantId,
      dto.documentType,
      file,
      user,
    );
  }

  // Admin - verify aspirant documents
  @Patch("aspirant/:aspirantId/document/:documentType/verify")
  @Roles("admin")
  @ApiOperation({ summary: "Admin - Verify or reject aspirant document" })
  @ApiParam({
    name: "aspirantId",
    type: "number",
    description: "Aspirant ID",
    example: 13,
  })
  @ApiParam({
    name: "documentType",
    description: "Type of document to verify",
    enum: [
      "sop",
      "sop_kannada",
      "agreement",
      "property_declaration",
      "code_of_conduct",
      "resume",
      "epic_card",
      "epic_card_back",
      "address_proof",
      "recent_photo",
      "selfie",
    ],
    example: "sop",
  })
  @ApiResponse({
    status: 200,
    description: "Document verification status updated",
  })
  @ApiResponse({ status: 403, description: "Forbidden - Admin role required" })
  @ApiResponse({ status: 404, description: "Aspirant not found" })
  async verifyAspirantDocument(
    @Param("aspirantId", ParseIntPipe) aspirantId: number,
    @Param("documentType") documentType: string,
    @Body() verifyDto: VerifyDocumentDto,
  ) {
    return await this.mediaService.verifyAspirantDocument(
      aspirantId,
      documentType,
      verifyDto,
    );
  }

  // Admin - upload global documents
  @Post("admin/document")
  @Roles("admin")
  @UseInterceptors(FileInterceptor("file"))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Admin - Upload global document template" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["documentType", "file"],
      properties: {
        documentType: {
          type: "string",
          enum: [
            "sop",
            "sop_kannada",
            "agreement",
            "property_declaration",
            "code_of_conduct",
          ],
          description: "Type of global document",
        },
        version: {
          type: "string",
          description: "Document version (e.g., v1.0)",
          example: "v1.0",
        },
        description: {
          type: "string",
          description: "Document description",
          example: "Updated terms for 2025",
        },
        file: {
          type: "string",
          format: "binary",
          description: "Document file (max 10MB)",
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: "Global document uploaded successfully",
  })
  @ApiResponse({ status: 403, description: "Forbidden - Admin role required" })
  async uploadAdminDocument(
    @Body() dto: UploadAdminDocumentDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return await this.mediaService.uploadAdminDocument(
      dto.documentType,
      file,
      dto.version,
      dto.description,
    );
  }

  // Get all active admin documents (accessible to all authenticated users)
  @Get("admin/documents")
  @ApiOperation({ summary: "Get all active global documents" })
  @ApiResponse({
    status: 200,
    description: "List of active global documents returned",
  })
  async getActiveAdminDocuments() {
    return await this.mediaService.getActiveAdminDocuments();
  }

  // Get specific admin document
  @Get("admin/document/:id")
  @ApiOperation({ summary: "Get specific global document by ID" })
  @ApiResponse({ status: 200, description: "Global document returned" })
  @ApiResponse({ status: 404, description: "Document not found" })
  async getAdminDocument(@Param("id", ParseIntPipe) id: number) {
    return await this.mediaService.getAdminDocumentById(id);
  }

  // User - sign and upload admin document
  @Post("sign-document")
  @UseInterceptors(FileInterceptor("file"))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Upload signed document" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["adminDocumentId", "file"],
      properties: {
        adminDocumentId: {
          type: "number",
          description: "ID of the admin document being signed",
          example: 1,
        },
        file: {
          type: "string",
          format: "binary",
          description: "Signed document file (max 10MB)",
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: "Signed document uploaded successfully",
  })
  @ApiResponse({ status: 404, description: "Admin document not found" })
  async signDocument(
    @Req() req: any,
    @Body() dto: SignDocumentDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const userId = req.user.id;
    return await this.mediaService.signDocument(
      userId,
      dto.adminDocumentId,
      file,
    );
  }

  // Get user's signed documents
  @Get("signed-documents")
  @ApiOperation({ summary: "Get current user's signed documents" })
  @ApiResponse({
    status: 200,
    description: "List of user's signed documents returned",
  })
  async getUserSignedDocuments(@Req() req: any) {
    const userId = req.user.id;
    return await this.mediaService.getUserSignedDocuments(userId);
  }

  // Admin - get all user signed documents
  @Get("admin/signed-documents")
  @Roles("admin")
  @ApiOperation({ summary: "Admin - Get all user signed documents" })
  @ApiResponse({
    status: 200,
    description: "List of all signed documents returned",
  })
  @ApiResponse({ status: 403, description: "Forbidden - Admin role required" })
  async getAllUserSignedDocuments() {
    return await this.mediaService.getAllUserSignedDocuments();
  }

  // Admin - verify user signed document
  @Patch("admin/signed-document/:id/verify")
  @Roles("admin")
  @ApiOperation({ summary: "Admin - Verify or reject user signed document" })
  @ApiResponse({
    status: 200,
    description: "Signed document verification status updated",
  })
  @ApiResponse({ status: 403, description: "Forbidden - Admin role required" })
  @ApiResponse({ status: 404, description: "Signed document not found" })
  async verifyUserSignedDocument(
    @Param("id", ParseIntPipe) id: number,
    @Body() verifyDto: VerifyDocumentDto,
  ) {
    return await this.mediaService.verifyUserSignedDocument(id, verifyDto);
  }
}
