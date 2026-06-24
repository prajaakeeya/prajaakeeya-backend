import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Notification } from "./notification.entity";
import { Aspirant } from "../aspirants/aspirant.entity";
import { AspirantMeeting } from "../aspirants/aspirant-meeting.entity";
import { AspirantVisit } from "../aspirants/aspirant-visit.entity";
import { ElectionType } from "../elections/election.entity";
import { FirebaseService } from "./firebase.service";

interface ConstituencyContext {
  electionType: ElectionType;
  constituencyName: string | null;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly repo: Repository<Notification>,
    private readonly firebase: FirebaseService,
  ) {}

  async list(
    userId: number,
    options: { page?: number; limit?: number; unreadOnly?: boolean } = {},
  ) {
    const page = Math.max(options.page ?? 1, 1);
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const qb = this.repo
      .createQueryBuilder("n")
      .where("n.userId = :userId", { userId })
      .orderBy("n.createdAt", "DESC")
      .skip((page - 1) * limit)
      .take(limit);
    if (options.unreadOnly) {
      qb.andWhere("n.isRead = :isRead", { isRead: false });
    }
    const [data, total] = await qb.getManyAndCount();
    const unreadCount = await this.unreadCount(userId);
    return {
      data,
      total,
      unreadCount,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  unreadCount(userId: number): Promise<number> {
    return this.repo.count({ where: { userId, isRead: false } });
  }

  async markRead(userId: number, id: number) {
    const notification = await this.repo.findOne({ where: { id, userId } });
    if (!notification) throw new NotFoundException("Notification not found");
    if (!notification.isRead) {
      notification.isRead = true;
      notification.readAt = new Date();
      await this.repo.save(notification);
    }
    return notification;
  }

  async markAllRead(userId: number) {
    const res = await this.repo
      .createQueryBuilder()
      .update(Notification)
      .set({ isRead: true, readAt: new Date() })
      .where("user_id = :userId AND is_read = false", { userId })
      .execute();
    return { updated: res.affected ?? 0 };
  }

  async deleteOne(userId: number, id: number) {
    const notification = await this.repo.findOne({ where: { id, userId } });
    if (!notification) throw new NotFoundException("Notification not found");
    await this.repo.delete(id);
    return { deleted: 1 };
  }

  async deleteAll(userId: number) {
    const res = await this.repo
      .createQueryBuilder()
      .delete()
      .from(Notification)
      .where("user_id = :userId", { userId })
      .execute();
    return { deleted: res.affected ?? 0 };
  }

  /**
   * Find every user whose saved constituency matches the aspirant's
   * election type + constituency. Excludes the aspirant's own userId so
   * the aspirant doesn't receive their own event notifications.
   */
  private async findRecipientUserIds(
    electionType: ElectionType,
    constituencyId: number,
    excludeUserId?: number,
  ): Promise<number[]> {
    const column = ({
      lok_sabha: "lok_sabha_constituency_id",
      state_assembly: "state_assembly_constituency_id",
      municipal_corporation: "municipal_corporation_constituency_id",
      gram_panchayat: "gram_panchayat_constituency_id",
    } as Record<ElectionType, string>)[electionType];
    if (!column) return [];

    const qb = this.repo.manager
      .createQueryBuilder()
      .select("u.id", "id")
      .from("users", "u")
      .where(`u.${column} = :constituencyId`, { constituencyId })
      .andWhere("u.is_blocked = false")
      .andWhere("u.is_self_deleted = false");
    if (excludeUserId) {
      qb.andWhere("u.id != :excludeUserId", { excludeUserId });
    }
    const rows = await qb.getRawMany();
    return rows.map((r) => Number(r.id));
  }

  /** Bulk-insert notification rows in chunks. */
  private async fanOut(
    userIds: number[],
    template: Omit<Partial<Notification>, "userId">,
  ) {
    if (!userIds.length) return { created: 0 };
    const CHUNK = 500;
    let created = 0;
    for (let i = 0; i < userIds.length; i += CHUNK) {
      const slice = userIds.slice(i, i + CHUNK);
      const rows = slice.map((userId) => this.repo.create({ ...template, userId }));
      await this.repo.save(rows);
      created += rows.length;
    }

    // Best-effort web push to the same recipients. Fire-and-forget: a no-op
    // when Firebase isn't configured, and never blocks/raises in the caller.
    void this.firebase.sendToUsers(userIds, {
      title: template.title ?? "Prajaakeeya",
      body: template.body ?? "",
      data: this.buildPushData(template),
      link: this.buildDeepLink(template),
    });

    return { created };
  }

  /**
   * Resolve the in-app deep-link path for a notification tap, from its type +
   * ids. Mirrors the client routing (NotificationsPage.hrefFor / the service
   * worker's resolveTarget). Always returns a path, falling back to the
   * signed-in dashboard so every tap lands somewhere useful.
   */
  private buildDeepLink(t: Omit<Partial<Notification>, "userId">): string {
    const aspirantId = t.aspirantId;
    switch (t.type) {
      case "new_aspirant":
        return aspirantId
          ? `/user/aspirants/${aspirantId}/view`
          : "/user/aspirantslist";
      case "chat_message":
        return aspirantId ? `/user/chat/${aspirantId}` : "/user/aspirantslist";
      case "voting_window": {
        const name = (t.metadata as { electionName?: string } | null)?.electionName;
        const slug = name
          ? name.replace(/\(.*?\)/g, "").trim().toLowerCase().replace(/\s+/g, "_") ||
            undefined
          : undefined;
        return slug ? `/user/aspirantslist?type=${slug}` : "/user/aspirantslist";
      }
      case "aspirant_meeting":
      case "aspirant_visit":
      case "aspirant_event":
      case "meeting_reminder":
      case "meeting_started":
      case "visit_reminder":
      case "visit_started": {
        const params = new URLSearchParams();
        if (t.electionId != null) params.set("electionId", String(t.electionId));
        if (aspirantId != null) params.set("aspirantId", String(aspirantId));
        const qs = params.toString();
        return qs ? `/user/aspirantslist?${qs}` : "/user/aspirantslist";
      }
      default:
        return "/user/dashboard";
    }
  }

  /** Map a notification template's scalar fields into an FCM data payload
   *  (all values must be strings) so the client can route on notification tap. */
  private buildPushData(
    t: Omit<Partial<Notification>, "userId">,
  ): Record<string, string> {
    const d: Record<string, string> = {};
    if (t.type != null) d.type = String(t.type);
    if (t.aspirantId != null) d.aspirantId = String(t.aspirantId);
    if (t.meetingId != null) d.meetingId = String(t.meetingId);
    if (t.visitId != null) d.visitId = String(t.visitId);
    if (t.electionId != null) d.electionId = String(t.electionId);
    if (t.constituencyId != null) d.constituencyId = String(t.constituencyId);
    return d;
  }

  /**
   * Notify all users in the aspirant's constituency that a new aspirant
   * has registered. Best-effort: failures are logged but don't break the
   * registration flow.
   */
  async notifyNewAspirant(aspirant: Aspirant, context: ConstituencyContext) {
    try {
      if (!aspirant.electionId || !aspirant.constituencyId) {
        return { created: 0 };
      }
      const recipients = await this.findRecipientUserIds(
        context.electionType,
        aspirant.constituencyId,
        aspirant.userId,
      );
      const constituencySuffix = context.constituencyName
        ? ` in ${context.constituencyName}`
        : "";
      return this.fanOut(recipients, {
        type: "new_aspirant",
        title: "New aspirant registered",
        body: `${aspirant.name} has registered as an aspirant${constituencySuffix}.`,
        aspirantId: aspirant.id,
        aspirantName: aspirant.name,
        electionId: aspirant.electionId,
        constituencyId: aspirant.constituencyId,
        constituencyName: context.constituencyName ?? null,
      });
    } catch (err) {
      this.logger.error(
        `notifyNewAspirant failed for aspirant ${aspirant.id}: ${(err as Error).message}`,
      );
      return { created: 0 };
    }
  }

  /**
   * Notify users in the aspirant's constituency about a scheduled
   * meeting. `meeting` may be from one of several persistence flows
   * (single, bulk, ward); only the fields we use are required.
   */
  async notifyAspirantMeeting(
    aspirant: Aspirant,
    meeting: AspirantMeeting | { id?: number; title?: string; startTime?: number },
    context: ConstituencyContext,
  ) {
    try {
      if (!aspirant.electionId || !aspirant.constituencyId) {
        return { created: 0 };
      }
      const recipients = await this.findRecipientUserIds(
        context.electionType,
        aspirant.constituencyId,
        aspirant.userId,
      );
      const meetingTitle = meeting.title || "a new meeting";
      const constituencySuffix = context.constituencyName
        ? ` (${context.constituencyName})`
        : "";
      return this.fanOut(recipients, {
        type: "aspirant_meeting",
        title: `${aspirant.name} scheduled a meeting`,
        body: `${aspirant.name}${constituencySuffix} scheduled "${meetingTitle}".`,
        aspirantId: aspirant.id,
        aspirantName: aspirant.name,
        electionId: aspirant.electionId,
        constituencyId: aspirant.constituencyId,
        constituencyName: context.constituencyName ?? null,
        meetingId: meeting.id ?? null,
        metadata: meeting.startTime ? { startTime: meeting.startTime } : null,
      });
    } catch (err) {
      this.logger.error(
        `notifyAspirantMeeting failed for aspirant ${aspirant.id}: ${(err as Error).message}`,
      );
      return { created: 0 };
    }
  }

  async notifyAspirantVisit(
    aspirant: Aspirant,
    visit: AspirantVisit,
    context: ConstituencyContext,
  ) {
    try {
      if (!aspirant.electionId || !aspirant.constituencyId) {
        return { created: 0 };
      }
      const recipients = await this.findRecipientUserIds(
        context.electionType,
        aspirant.constituencyId,
        aspirant.userId,
      );
      const visitTitle = visit.title || "a ward visit";
      const locationSuffix = visit.location ? ` at ${visit.location}` : "";
      return this.fanOut(recipients, {
        type: "aspirant_visit",
        title: `${aspirant.name} planned a visit`,
        body: `${aspirant.name} planned "${visitTitle}"${locationSuffix}.`,
        aspirantId: aspirant.id,
        aspirantName: aspirant.name,
        electionId: aspirant.electionId,
        constituencyId: aspirant.constituencyId,
        constituencyName: context.constituencyName ?? null,
        visitId: visit.id ?? null,
        metadata: {
          startTime: visit.startTime ?? null,
          location: visit.location ?? null,
        },
      });
    } catch (err) {
      this.logger.error(
        `notifyAspirantVisit failed for aspirant ${aspirant.id}: ${(err as Error).message}`,
      );
      return { created: 0 };
    }
  }

  // ── Reminder notifications (fired by the scheduler). Like the original
  // "scheduled" notification, these fan out to EVERY voter in the aspirant's
  // constituency (excluding the aspirant). They use distinct notification
  // types so the FE can render them as reminders.

  /** "Meeting starts in 15 minutes" — to the whole constituency. */
  async notifyMeetingReminder(
    aspirant: Aspirant,
    meeting: AspirantMeeting,
    context: ConstituencyContext,
  ) {
    return this.fanOutReminder(aspirant, context, {
      type: "meeting_reminder",
      title: "Meeting starting soon",
      body: `${aspirant.name}'s meeting "${meeting.title || "a meeting"}" starts in 15 minutes.`,
      meetingId: meeting.id ?? null,
      metadata: { startTime: meeting.startTime ?? null, lead: "15m" },
    });
  }

  /** "Meeting is starting now" — to the whole constituency. */
  async notifyMeetingStart(
    aspirant: Aspirant,
    meeting: AspirantMeeting,
    context: ConstituencyContext,
  ) {
    return this.fanOutReminder(aspirant, context, {
      type: "meeting_started",
      title: "Meeting starting now",
      body: `${aspirant.name}'s meeting "${meeting.title || "a meeting"}" is starting now.`,
      meetingId: meeting.id ?? null,
      metadata: { startTime: meeting.startTime ?? null, lead: "0m" },
    });
  }

  /** "Visit starts in 15 minutes" — to the whole constituency. */
  async notifyVisitReminder(
    aspirant: Aspirant,
    visit: AspirantVisit,
    context: ConstituencyContext,
  ) {
    const locationSuffix = visit.location ? ` at ${visit.location}` : "";
    return this.fanOutReminder(aspirant, context, {
      type: "visit_reminder",
      title: "Visit starting soon",
      body: `${aspirant.name}'s visit "${visit.title || "a ward visit"}"${locationSuffix} starts in 15 minutes.`,
      visitId: visit.id ?? null,
      metadata: {
        startTime: visit.startTime ?? null,
        location: visit.location ?? null,
        lead: "15m",
      },
    });
  }

  /** "Visit is starting now" — to the whole constituency, at start time. */
  async notifyVisitStart(
    aspirant: Aspirant,
    visit: AspirantVisit,
    context: ConstituencyContext,
  ) {
    const locationSuffix = visit.location ? ` at ${visit.location}` : "";
    return this.fanOutReminder(aspirant, context, {
      type: "visit_started",
      title: "Visit starting now",
      body: `${aspirant.name}'s visit "${visit.title || "a ward visit"}"${locationSuffix} is starting now.`,
      visitId: visit.id ?? null,
      metadata: {
        startTime: visit.startTime ?? null,
        location: visit.location ?? null,
        lead: "0m",
      },
    });
  }

  /**
   * Shared fan-out for reminder notifications: resolves all constituency
   * recipients (minus the aspirant) and bulk-inserts the rows. Best-effort —
   * failures are logged, never thrown.
   */
  private async fanOutReminder(
    aspirant: Aspirant,
    context: ConstituencyContext,
    template: Omit<Partial<Notification>, "userId">,
  ) {
    try {
      if (!aspirant.electionId || !aspirant.constituencyId) {
        return { created: 0 };
      }
      const recipients = await this.findRecipientUserIds(
        context.electionType,
        aspirant.constituencyId,
        aspirant.userId,
      );
      return this.fanOut(recipients, {
        aspirantId: aspirant.id,
        aspirantName: aspirant.name,
        electionId: aspirant.electionId,
        constituencyId: aspirant.constituencyId,
        constituencyName: context.constituencyName ?? null,
        ...template,
      });
    } catch (err) {
      this.logger.error(
        `reminder fan-out (${template.type}) failed for aspirant ${aspirant.id}: ${(err as Error).message}`,
      );
      return { created: 0 };
    }
  }

  /**
   * Notify every prior participant in an aspirant's chat room (plus the
   * aspirant themselves) about a new message. Recipients are the union
   * of:
   *   - distinct userIds who have ever posted in this chat
   *   - the aspirant's own userId
   * minus the sender.
   */
  async notifyAspirantChatMessage(args: {
    aspirantId: number;
    aspirantUserId?: number | null;
    aspirantName: string;
    senderId: number;
    senderName?: string | null;
    content: string;
  }) {
    try {
      // Single JOIN: resolve the distinct recipient user-ids who have posted in
      // this chat directly in SQL, filtering blocked/self-deleted users in the
      // same query (replacing the old query-then-filter two-step). The
      // aspirant's own user (if any, and not the sender) is OR'd in, subject to
      // the identical active-user filter the old path applied to it.
      const qb = this.repo.manager
        .createQueryBuilder()
        .select("DISTINCT u.id", "userId")
        .from("users", "u")
        .where("u.is_blocked = false")
        .andWhere("u.is_self_deleted = false")
        .andWhere("u.id != :senderId", { senderId: args.senderId });

      if (args.aspirantUserId && args.aspirantUserId !== args.senderId) {
        qb.andWhere(
          `(u.id = :aspirantUserId OR u.id IN (
             SELECT m.user_id FROM aspirant_messages m WHERE m.aspirant_id = :aspirantId
           ))`,
          { aspirantUserId: args.aspirantUserId, aspirantId: args.aspirantId },
        );
      } else {
        qb.andWhere(
          `u.id IN (
             SELECT m.user_id FROM aspirant_messages m WHERE m.aspirant_id = :aspirantId
           )`,
          { aspirantId: args.aspirantId },
        );
      }

      const rows = await qb.getRawMany();
      const finalIds = rows.map((r) => Number(r.userId));
      if (!finalIds.length) return { created: 0 };

      const senderLabel = args.senderName?.trim() || "Someone";
      const preview =
        args.content.length > 120
          ? `${args.content.slice(0, 117)}…`
          : args.content;
      return this.fanOut(finalIds, {
        type: "chat_message",
        title: `New message in ${args.aspirantName}'s chat`,
        body: `${senderLabel}: ${preview}`,
        aspirantId: args.aspirantId,
        aspirantName: args.aspirantName,
        metadata: { senderId: args.senderId },
      });
    } catch (err) {
      this.logger.error(
        `notifyAspirantChatMessage failed for aspirant ${args.aspirantId}: ${(err as Error).message}`,
      );
      return { created: 0 };
    }
  }

  /**
   * Fan out a notification to every active user that a voting window
   * has been opened/scheduled. Used when an admin sets a new window.
   */
  async notifyVotingWindowOpened(window: {
    startTime: number;
    endTime: number;
    description?: string | null;
    electionName?: string | null;
  }) {
    try {
      const rows = await this.repo.manager
        .createQueryBuilder()
        .select("u.id", "id")
        .from("users", "u")
        .where("u.is_blocked = false")
        .andWhere("u.is_self_deleted = false")
        .getRawMany();
      const recipients = rows.map((r) => Number(r.id));
      if (!recipients.length) return { created: 0 };

      const electionSuffix = window.electionName
        ? ` for ${window.electionName}`
        : "";
      const startStr = new Date(window.startTime).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short",
      });
      const endStr = new Date(window.endTime).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short",
      });

      return this.fanOut(recipients, {
        type: "voting_window",
        title: `Voting window opened${electionSuffix}`,
        body: `Voting is open from ${startStr} to ${endStr}. Cast your vote before it closes.`,
        metadata: {
          startTime: window.startTime,
          endTime: window.endTime,
          description: window.description ?? null,
          electionName: window.electionName ?? null,
        },
      });
    } catch (err) {
      this.logger.error(
        `notifyVotingWindowOpened failed: ${(err as Error).message}`,
      );
      return { created: 0 };
    }
  }

  /**
   * Generic event notification — for anything beyond meetings/visits
   * (e.g. manifesto update, profile changes, ad-hoc announcements).
   */
  async notifyAspirantEvent(
    aspirant: Aspirant,
    context: ConstituencyContext,
    event: { title: string; body: string; metadata?: Record<string, any> },
  ) {
    try {
      if (!aspirant.electionId || !aspirant.constituencyId) {
        return { created: 0 };
      }
      const recipients = await this.findRecipientUserIds(
        context.electionType,
        aspirant.constituencyId,
        aspirant.userId,
      );
      return this.fanOut(recipients, {
        type: "aspirant_event",
        title: event.title,
        body: event.body,
        aspirantId: aspirant.id,
        aspirantName: aspirant.name,
        electionId: aspirant.electionId,
        constituencyId: aspirant.constituencyId,
        constituencyName: context.constituencyName ?? null,
        metadata: event.metadata ?? null,
      });
    } catch (err) {
      this.logger.error(
        `notifyAspirantEvent failed for aspirant ${aspirant.id}: ${(err as Error).message}`,
      );
      return { created: 0 };
    }
  }
}
