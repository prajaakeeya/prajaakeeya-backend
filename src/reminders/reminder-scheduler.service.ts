import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";

import { AspirantMeeting } from "../aspirants/aspirant-meeting.entity";
import { AspirantVisit } from "../aspirants/aspirant-visit.entity";
import { Aspirant } from "../aspirants/aspirant.entity";
import { NotificationsService } from "../notifications/notifications.service";
import { ElectionsService } from "../elections/elections.service";
import { ElectionType } from "../elections/election.entity";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
// Grace window for the "starting now" notification: catches items whose start
// time just passed (e.g. if the box was briefly down) without ever firing for
// long-finished ones.
const START_GRACE_MS = 5 * 60 * 1000;

interface ConstituencyContext {
  electionType: ElectionType;
  constituencyName: string | null;
}

/**
 * Sends meeting/visit reminders on a per-minute tick. For BOTH meetings and
 * visits:
 *   • 15 minutes before start
 *   • at start time ("starting now")
 *
 * Recipients are every voter in the aspirant's constituency (same audience as
 * the original "scheduled" notification). Each reminder is guarded by a
 * `reminder_*_sent` flag on the row so it is sent exactly once.
 */
@Injectable()
export class ReminderSchedulerService {
  private readonly logger = new Logger(ReminderSchedulerService.name);

  constructor(
    @InjectRepository(AspirantMeeting)
    private readonly meetingRepo: Repository<AspirantMeeting>,
    @InjectRepository(AspirantVisit)
    private readonly visitRepo: Repository<AspirantVisit>,
    @InjectRepository(Aspirant)
    private readonly aspirantRepo: Repository<Aspirant>,
    private readonly notifications: NotificationsService,
    private readonly electionsService: ElectionsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    // In PM2 cluster mode every worker would run this cron — only let worker 0
    // do it, otherwise reminders would be sent N times. (Single-process runs
    // have NODE_APP_INSTANCE unset, so this passes.)
    if (
      process.env.NODE_APP_INSTANCE &&
      process.env.NODE_APP_INSTANCE !== "0"
    ) {
      return;
    }

    const now = Date.now();
    const results = await Promise.allSettled([
      this.sendMeetingBeforeReminders(now),
      this.sendMeetingStartNotifications(now),
      this.sendVisitBeforeReminders(now),
      this.sendVisitStartNotifications(now),
    ]);
    for (const r of results) {
      if (r.status === "rejected") {
        this.logger.error(
          `reminder tick failed: ${(r.reason as Error)?.message ?? r.reason}`,
        );
      }
    }
  }

  /**
   * Batch-load the aspirant context for a set of due rows: one query for all
   * aspirants, then resolve each aspirant's election context. Returns a Map
   * keyed by aspirantId of the same shape resolveAspirantContext produced.
   */
  private async resolveAspirantContextsBulk(
    aspirantIds: number[],
  ): Promise<
    Map<number, { aspirant: Aspirant; context: ConstituencyContext }>
  > {
    const out = new Map<
      number,
      { aspirant: Aspirant; context: ConstituencyContext }
    >();
    if (!aspirantIds.length) return out;

    const aspirants = await this.aspirantRepo.find({
      where: { id: In(aspirantIds) },
    });

    await Promise.allSettled(
      aspirants.map(async (aspirant) => {
        if (!aspirant.electionId || !aspirant.constituencyId) return;
        try {
          const election = await this.electionsService.findById(
            aspirant.electionId,
          );
          if (!election) return;
          out.set(aspirant.id, {
            aspirant,
            context: {
              electionType: election.type as ElectionType,
              constituencyName: null,
            },
          });
        } catch {
          /* skip aspirants whose election can't be resolved */
        }
      }),
    );

    return out;
  }

  // ── Meetings ────────────────────────────────────────────────────────────

  private async sendMeetingBeforeReminders(now: number): Promise<void> {
    const windowEnd = now + FIFTEEN_MIN_MS;
    const meetings = await this.meetingRepo
      .createQueryBuilder("m")
      .where("m.reminderBeforeSent = false")
      .andWhere("m.startTime IS NOT NULL")
      .andWhere("m.startTime > :now", { now })
      .andWhere("m.startTime <= :windowEnd", { windowEnd })
      .getMany();

    if (!meetings.length) return;

    const ids = [...new Set(meetings.map((m) => m.aspirantId))];
    const contexts = await this.resolveAspirantContextsBulk(ids);

    await Promise.allSettled(
      meetings.map(async (meeting) => {
        const resolved = contexts.get(meeting.aspirantId);
        if (resolved) {
          await this.notifications.notifyMeetingReminder(
            resolved.aspirant,
            meeting,
            resolved.context,
          );
        }
      }),
    );

    // One bulk update for the "before" flag.
    await this.meetingRepo.update(
      { id: In(meetings.map((m) => m.id)) },
      { reminderBeforeSent: true },
    );
  }

  private async sendMeetingStartNotifications(now: number): Promise<void> {
    const graceStart = now - START_GRACE_MS;
    const meetings = await this.meetingRepo
      .createQueryBuilder("m")
      .where("m.reminderStartSent = false")
      .andWhere("m.startTime IS NOT NULL")
      .andWhere("m.startTime <= :now", { now })
      .andWhere("m.startTime > :graceStart", { graceStart })
      .getMany();

    if (!meetings.length) return;

    const ids = [...new Set(meetings.map((m) => m.aspirantId))];
    const contexts = await this.resolveAspirantContextsBulk(ids);

    await Promise.allSettled(
      meetings.map(async (meeting) => {
        const resolved = contexts.get(meeting.aspirantId);
        if (resolved) {
          await this.notifications.notifyMeetingStart(
            resolved.aspirant,
            meeting,
            resolved.context,
          );
        }
      }),
    );

    // One bulk update for the "start" flag.
    await this.meetingRepo.update(
      { id: In(meetings.map((m) => m.id)) },
      { reminderStartSent: true },
    );
  }

  // ── Visits ──────────────────────────────────────────────────────────────

  private async sendVisitBeforeReminders(now: number): Promise<void> {
    const windowEnd = now + FIFTEEN_MIN_MS;
    const visits = await this.visitRepo
      .createQueryBuilder("v")
      .where("v.reminderBeforeSent = false")
      .andWhere("v.startTime IS NOT NULL")
      .andWhere("v.startTime > :now", { now })
      .andWhere("v.startTime <= :windowEnd", { windowEnd })
      .getMany();

    if (!visits.length) return;

    const ids = [...new Set(visits.map((v) => v.aspirantId))];
    const contexts = await this.resolveAspirantContextsBulk(ids);

    await Promise.allSettled(
      visits.map(async (visit) => {
        const resolved = contexts.get(visit.aspirantId);
        if (resolved) {
          await this.notifications.notifyVisitReminder(
            resolved.aspirant,
            visit,
            resolved.context,
          );
        }
      }),
    );

    // One bulk update for the "before" flag.
    await this.visitRepo.update(
      { id: In(visits.map((v) => v.id)) },
      { reminderBeforeSent: true },
    );
  }

  private async sendVisitStartNotifications(now: number): Promise<void> {
    const graceStart = now - START_GRACE_MS;
    const visits = await this.visitRepo
      .createQueryBuilder("v")
      .where("v.reminderStartSent = false")
      .andWhere("v.startTime IS NOT NULL")
      .andWhere("v.startTime <= :now", { now })
      .andWhere("v.startTime > :graceStart", { graceStart })
      .getMany();

    if (!visits.length) return;

    const ids = [...new Set(visits.map((v) => v.aspirantId))];
    const contexts = await this.resolveAspirantContextsBulk(ids);

    await Promise.allSettled(
      visits.map(async (visit) => {
        const resolved = contexts.get(visit.aspirantId);
        if (resolved) {
          await this.notifications.notifyVisitStart(
            resolved.aspirant,
            visit,
            resolved.context,
          );
        }
      }),
    );

    // One bulk update for the "start" flag.
    await this.visitRepo.update(
      { id: In(visits.map((v) => v.id)) },
      { reminderStartSent: true },
    );
  }
}
