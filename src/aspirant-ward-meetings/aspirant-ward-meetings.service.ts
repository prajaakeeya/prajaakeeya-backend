import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { WardsService } from "../wards/wards.service";
import { AspirantsService } from "../aspirants/aspirants.service";
import { UsersService } from "../users/users.service";
import { CreateAspirantWardMeetingDto } from "./dto/create-aspirant-ward-meeting.dto";
import { NotificationsService } from "../notifications/notifications.service";
import { ElectionsService } from "../elections/elections.service";
import { ElectionType } from "../elections/election.entity";
import { CreateWardMeetingDto } from "../wards/dto/create-ward-meeting.dto";

@Injectable()
export class AspirantWardMeetingsService {
  constructor(
    private readonly wardsService: WardsService,
    private readonly aspirantsService: AspirantsService,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
    private readonly electionsService: ElectionsService,
  ) {}

  async createMeetingForAspirant(
    userId: number,
    dto: CreateAspirantWardMeetingDto,
  ) {
    const aspirant = await this.aspirantsService.findByUserId(userId);
    if (!aspirant)
      throw new NotFoundException("Aspirant profile not found for this user");

    // Ensure ward exists (wardsService.createMeeting will verify but sanity-check here)
    const wardId = aspirant.wardId;

    const payload = {
      wardId,
      title: dto.title,
      description: dto.description,
      meetingLink: dto.meetingLink,
      scheduledAt: dto.scheduledAt,
    };

    const meeting = await this.wardsService.createMeeting(
      payload as CreateWardMeetingDto,
      userId,
    );

    // Fan out an in-app notification to every user whose saved
    // constituency matches the aspirant's. Best-effort: don't break the
    // create flow if the lookup or insert fails.
    try {
      if (aspirant.electionId && aspirant.constituencyId) {
        const election = await this.electionsService.findById(
          aspirant.electionId,
        );
        await this.notificationsService.notifyAspirantMeeting(
          aspirant,
          {
            id: meeting.id,
            title: meeting.title,
            startTime: meeting.scheduledAt
              ? new Date(meeting.scheduledAt).getTime()
              : undefined,
          },
          {
            electionType: election.type as ElectionType,
            constituencyName: null,
          },
        );
      }
    } catch {
      /* best-effort */
    }

    return meeting;
  }

  async getMeetingsForUserWard(userId: number) {
    // Prefer ward from user profile (voters/aspirants), fallback to aspirant record
    const user = await this.usersService.findById(userId);
    let wardId: number | undefined = undefined;

    if (user && user.wardId) {
      wardId = user.wardId;
    } else {
      const aspirant = await this.aspirantsService.findByUserId(userId);
      if (aspirant?.wardId) wardId = aspirant.wardId;
    }

    if (!wardId) {
      throw new NotFoundException("No ward associated with this user");
    }

    return this.wardsService.getActiveMeetingsByWard(wardId);
  }

  async completeMeeting(userId: number, meetingId: number, notes: string) {
    const meeting = await this.wardsService.getMeetingById(meetingId);
    if (!meeting) throw new NotFoundException("Meeting not found");

    // allow creator or admin to complete the meeting
    const user = await this.usersService.findById(userId);
    const isCreator = meeting.createdById === userId;
    const isAdmin = user && user.role === "admin";
    if (!isCreator && !isAdmin) {
      throw new ForbiddenException(
        "Not authorized to add notes to this meeting",
      );
    }

    return this.wardsService.completeMeeting(meetingId, notes);
  }

  async deleteMeeting(userId: number, meetingId: number) {
    const meeting = await this.wardsService.getMeetingById(meetingId);
    if (!meeting) throw new NotFoundException("Meeting not found");

    const user = await this.usersService.findById(userId);
    const isCreator = meeting.createdById === userId;
    const isAdmin = user && user.role === "admin";
    if (!isCreator && !isAdmin) {
      throw new ForbiddenException("Not authorized to delete this meeting");
    }

    await this.wardsService.deleteMeeting(meetingId);
    return { deleted: 1 };
  }
}
