import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { S3Service } from "./s3.service";
import { User } from "../../users/user.entity";
import { Aspirant } from "../../aspirants/aspirant.entity";
import { AdminDocument } from "../../admin/admin-document.entity";
import { UserSignedDocument } from "../../users/user-signed-document.entity";
import { VerifyDocumentDto } from "../dto/media-upload.dto";
import { AspirantsService } from "../../aspirants/aspirants.service";

@Injectable()
export class MediaService {
  constructor(
    private readonly s3Service: S3Service,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Aspirant)
    private readonly aspirantRepo: Repository<Aspirant>,
    @InjectRepository(AdminDocument)
    private readonly adminDocRepo: Repository<AdminDocument>,
    @InjectRepository(UserSignedDocument)
    private readonly userSignedDocRepo: Repository<UserSignedDocument>,
    @Inject(forwardRef(() => AspirantsService))
    private readonly aspirantsService: AspirantsService,
  ) {}

  async uploadProfilePicture(
    userId: number,
    file: Express.Multer.File,
  ): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException("User not found");
    }

    // Delete old profile picture if exists
    if (user.profilePicture) {
      await this.s3Service.deleteFile(user.profilePicture);
    }

    // Upload new profile picture
    const url = await this.s3Service.uploadFile(file, `profiles/${userId}`);
    user.profilePicture = url;
    return await this.userRepo.save(user);
  }

  async deleteProfilePicture(userId: number): Promise<{ message: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");
    if (!user.profilePicture)
      throw new BadRequestException("No profile picture to delete");

    await this.s3Service.deleteFile(user.profilePicture);
    user.profilePicture = null as any;
    await this.userRepo.save(user);
    return { message: "Profile picture deleted successfully" };
  }

  async uploadAspirantDocument(
    aspirantId: number,
    documentType: string,
    file: Express.Multer.File,
    user: { id?: number; role?: string } = {},
  ): Promise<Aspirant> {
    const aspirant = await this.aspirantRepo.findOne({
      where: { id: aspirantId },
    });
    if (!aspirant) {
      throw new NotFoundException("Aspirant not found");
    }
    // Ownership: only the aspirant's own user (or an admin) may upload/replace
    // their documents. Without this, any logged-in user could overwrite another
    // aspirant's SOP/EPIC/selfie and force-approve them.
    if (user?.role !== "admin" && aspirant.userId !== user?.id) {
      throw new ForbiddenException(
        "You can only upload documents for your own aspirant profile",
      );
    }

    // Snapshot the document-completion state before this upload so we can
    // detect the first incomplete→complete transition and fan out the
    // "new aspirant registered" notification exactly once at that point.
    const wasComplete = aspirant.hasAllRequiredDocuments();

    const url = await this.s3Service.uploadFile(
      file,
      `aspirants/${aspirantId}/documents`,
    );

    // Update specific document field
    switch (documentType) {
      case "sop":
        if (aspirant.sopUrl) await this.s3Service.deleteFile(aspirant.sopUrl);
        aspirant.sopUrl = url;
        aspirant.sopStatus = "pending";
        break;
      case "sop_kannada":
        if (aspirant.sopKannadaUrl)
          await this.s3Service.deleteFile(aspirant.sopKannadaUrl);
        aspirant.sopKannadaUrl = url;
        aspirant.sopKannadaStatus = "pending";
        break;
      case "agreement":
        if (aspirant.agreementUrl)
          await this.s3Service.deleteFile(aspirant.agreementUrl);
        aspirant.agreementUrl = url;
        aspirant.agreementStatus = "pending";
        break;
      case "property_declaration":
        if (aspirant.propertyDeclarationUrl)
          await this.s3Service.deleteFile(aspirant.propertyDeclarationUrl);
        aspirant.propertyDeclarationUrl = url;
        aspirant.propertyDeclarationStatus = "pending";
        break;
      case "code_of_conduct":
        if (aspirant.codeOfConductUrl)
          await this.s3Service.deleteFile(aspirant.codeOfConductUrl);
        aspirant.codeOfConductUrl = url;
        aspirant.codeOfConductStatus = "pending";
        break;
      case "resume":
        if (aspirant.resumeUrl)
          await this.s3Service.deleteFile(aspirant.resumeUrl);
        aspirant.resumeUrl = url;
        aspirant.resumeStatus = "pending";
        break;
      case "epic_card":
        if (aspirant.epicCardUrl)
          await this.s3Service.deleteFile(aspirant.epicCardUrl);
        aspirant.epicCardUrl = url;
        aspirant.epicCardStatus = "pending";
        break;
      case "epic_card_back":
        if (aspirant.epicCardBackUrl)
          await this.s3Service.deleteFile(aspirant.epicCardBackUrl);
        aspirant.epicCardBackUrl = url;
        aspirant.epicCardBackStatus = "pending";
        break;
      case "address_proof":
        if (aspirant.addressProofUrl)
          await this.s3Service.deleteFile(aspirant.addressProofUrl);
        aspirant.addressProofUrl = url;
        aspirant.addressProofStatus = "pending";
        break;
      case "recent_photo":
        if (aspirant.recentPhotoUrl)
          await this.s3Service.deleteFile(aspirant.recentPhotoUrl);
        aspirant.recentPhotoUrl = url;
        aspirant.recentPhotoStatus = "pending";
        break;
      case "selfie":
        if (aspirant.selfieUrl)
          await this.s3Service.deleteFile(aspirant.selfieUrl);
        aspirant.selfieUrl = url;
        aspirant.selfieStatus = "pending";
        if (aspirant.userId) {
          const user = await this.userRepo.findOne({
            where: { id: aspirant.userId },
          });
          if (user) {
            user.profilePicture = url;
            await this.userRepo.save(user);
          }
        }
        break;
      default:
        throw new BadRequestException("Invalid document type");
    }

    await this.aspirantRepo.save(aspirant);

    // Auto-approve if all required documents are uploaded (excluding SOP)
    if (aspirant.hasAllRequiredDocuments() && aspirant.status !== "approved") {
      aspirant.status = "approved";
      await this.aspirantRepo.save(aspirant);
    }

    // Fire the "new aspirant registered" notification only at the first
    // incomplete→complete transition. Re-uploads of other documents
    // (when already complete) skip this. Best-effort: never block upload.
    if (!wasComplete && aspirant.hasAllRequiredDocuments()) {
      await this.aspirantsService
        .dispatchNewAspirantNotification(aspirant)
        .catch(() => undefined);
    }

    return aspirant;
  }

  async verifyAspirantDocument(
    aspirantId: number,
    documentType: string,
    verifyDto: VerifyDocumentDto,
  ): Promise<Aspirant> {
    const aspirant = await this.aspirantRepo.findOne({
      where: { id: aspirantId },
    });
    if (!aspirant) {
      throw new NotFoundException("Aspirant not found");
    }

    // Update verification status
    switch (documentType) {
      case "sop":
        aspirant.sopStatus = verifyDto.status;
        break;
      case "sop_kannada":
        aspirant.sopKannadaStatus = verifyDto.status;
        break;
      case "agreement":
        aspirant.agreementStatus = verifyDto.status;
        break;
      case "property_declaration":
        aspirant.propertyDeclarationStatus = verifyDto.status;
        break;
      case "code_of_conduct":
        aspirant.codeOfConductStatus = verifyDto.status;
        break;
      case "resume":
        aspirant.resumeStatus = verifyDto.status;
        break;
      case "epic_card":
        aspirant.epicCardStatus = verifyDto.status;
        break;
      case "epic_card_back":
        aspirant.epicCardBackStatus = verifyDto.status;
        break;
      case "address_proof":
        aspirant.addressProofStatus = verifyDto.status;
        break;
      case "recent_photo":
        aspirant.recentPhotoStatus = verifyDto.status;
        break;
      case "selfie":
        aspirant.selfieStatus = verifyDto.status;
        break;
      default:
        throw new BadRequestException("Invalid document type");
    }

    if (verifyDto.status === "rejected" && verifyDto.rejectionReason) {
      const reasons = aspirant.rejectionReasons
        ? JSON.parse(aspirant.rejectionReasons)
        : {};
      reasons[documentType] = verifyDto.rejectionReason;
      aspirant.rejectionReasons = JSON.stringify(reasons);
    }

    if (verifyDto.status === "verified" && aspirant.rejectionReasons) {
      try {
        const reasons = JSON.parse(aspirant.rejectionReasons);
        if (
          reasons &&
          Object.prototype.hasOwnProperty.call(reasons, documentType)
        ) {
          delete reasons[documentType];
          const keys = Object.keys(reasons || {});
          aspirant.rejectionReasons = keys.length
            ? JSON.stringify(reasons)
            : (null as any);
        }
      } catch (e) {
        // If parsing fails, clear the field to avoid stale data
        aspirant.rejectionReasons = null as any;
      }
    }

    return await this.aspirantRepo.save(aspirant);
  }

  // Admin document management
  async uploadAdminDocument(
    documentType: string,
    file: Express.Multer.File,
    version?: string,
    description?: string,
  ): Promise<AdminDocument> {
    const url = await this.s3Service.uploadFile(
      file,
      `admin/documents/${documentType}`,
    );

    // Deactivate previous versions
    await this.adminDocRepo.update(
      { documentType: documentType as any, isActive: true },
      { isActive: false },
    );

    const adminDoc = this.adminDocRepo.create({
      documentType: documentType as any,
      documentUrl: url,
      version,
      description,
      isActive: true,
    });

    return await this.adminDocRepo.save(adminDoc);
  }

  async getActiveAdminDocuments(): Promise<AdminDocument[]> {
    return await this.adminDocRepo.find({
      where: { isActive: true },
      order: { documentType: "ASC" },
    });
  }

  async getAdminDocumentById(id: number): Promise<AdminDocument> {
    const doc = await this.adminDocRepo.findOne({ where: { id } });
    if (!doc) {
      throw new NotFoundException("Admin document not found");
    }
    return doc;
  }

  // User signed documents
  async signDocument(
    userId: number,
    adminDocumentId: number,
    file: Express.Multer.File,
  ): Promise<UserSignedDocument> {
    const adminDoc = await this.adminDocRepo.findOne({
      where: { id: adminDocumentId },
    });
    if (!adminDoc) {
      throw new NotFoundException("Admin document not found");
    }

    const url = await this.s3Service.uploadFile(
      file,
      `users/${userId}/signed-documents`,
    );

    // Check if already signed
    let signedDoc = await this.userSignedDocRepo.findOne({
      where: { userId, adminDocumentId },
    });

    if (signedDoc) {
      // Update existing
      if (signedDoc.signedDocumentUrl) {
        await this.s3Service.deleteFile(signedDoc.signedDocumentUrl);
      }
      signedDoc.signedDocumentUrl = url;
      signedDoc.status = "signed";
      signedDoc.signedAt = new Date();
    } else {
      // Create new
      signedDoc = this.userSignedDocRepo.create({
        userId,
        adminDocumentId,
        signedDocumentUrl: url,
        status: "signed",
        signedAt: new Date(),
      });
    }

    return await this.userSignedDocRepo.save(signedDoc);
  }

  async getUserSignedDocuments(userId: number): Promise<UserSignedDocument[]> {
    return await this.userSignedDocRepo.find({
      where: { userId },
      relations: { adminDocument: true },
    });
  }

  async verifyUserSignedDocument(
    signedDocId: number,
    verifyDto: VerifyDocumentDto,
  ): Promise<UserSignedDocument> {
    const signedDoc = await this.userSignedDocRepo.findOne({
      where: { id: signedDocId },
    });
    if (!signedDoc) {
      throw new NotFoundException("Signed document not found");
    }

    signedDoc.status = verifyDto.status;
    if (verifyDto.status === "rejected") {
      signedDoc.rejectionReason = verifyDto.rejectionReason;
    } else if (verifyDto.status === "verified") {
      signedDoc.verifiedAt = new Date();
    }

    return await this.userSignedDocRepo.save(signedDoc);
  }

  async getAllUserSignedDocuments(): Promise<UserSignedDocument[]> {
    return await this.userSignedDocRepo.find({
      relations: { user: true, adminDocument: true },
      order: { createdAt: "DESC" },
    });
  }

  async getPresignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    return await this.s3Service.getPresignedUrl(key, expiresInSeconds);
  }
}
