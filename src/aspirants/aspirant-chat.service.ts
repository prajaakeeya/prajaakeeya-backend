import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AspirantMessage } from "./aspirant-message.entity";
import { Aspirant } from "./aspirant.entity";
import { CreateAspirantMessageDto } from "./dto/create-aspirant-message.dto";
import { GetAspirantMessagesDto } from "./dto/get-aspirant-messages.dto";
import { NotificationsService } from "../notifications/notifications.service";
import { ChatEventsService } from "./chat-events.service";
import { User } from "../users/user.entity";

@Injectable()
export class AspirantChatService {
  constructor(
    @InjectRepository(AspirantMessage)
    private readonly repo: Repository<AspirantMessage>,
    @InjectRepository(Aspirant)
    private readonly aspirantRepo: Repository<Aspirant>,
    private readonly notificationsService: NotificationsService,
    private readonly chatEvents: ChatEventsService,
  ) {}

  async createMessage(
    userId: number,
    aspirantId: number,
    dto: CreateAspirantMessageDto,
  ) {
    const message = this.repo.create({
      content: dto.content,
      userId,
      aspirantId,
    });
    const saved = await this.repo.save(message);

    // Push to live SSE subscribers in this room immediately.
    this.chatEvents.publish({
      aspirantId,
      type: "message.created",
      payload: saved,
    });

    // Fan out a notification to every prior participant + the aspirant,
    // excluding the sender. Best-effort: chat must not fail if the
    // notification insert fails.
    try {
      const [aspirant, sender] = await Promise.all([
        this.aspirantRepo.findOne({
          where: { id: aspirantId },
          relations: ["user"],
        }),
        this.repo.manager
          .getRepository(User)
          .findOne({ where: { id: userId } })
          .catch(() => null),
      ]);
      if (aspirant) {
        await this.notificationsService.notifyAspirantChatMessage({
          aspirantId,
          aspirantUserId: aspirant.userId ?? null,
          aspirantName: aspirant.name,
          senderId: userId,
          senderName: sender?.name ?? null,
          content: dto.content,
        });
      }
    } catch {
      /* best-effort */
    }

    return saved;
  }

  async getMessages(aspirantId: number, query: GetAspirantMessagesDto) {
    const { page = 1, limit = 50 } = query;
    const skip = (page - 1) * limit;

    const [messages, total] = await this.repo.findAndCount({
      where: { aspirantId },
      order: { createdAt: "DESC" },
      skip,
      take: limit,
    });

    return {
      data: messages,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async deleteMessage(messageId: number, userId: number) {
    const message = await this.repo.findOne({ where: { id: messageId } });
    if (!message) throw new NotFoundException("Message not found");
    if (message.userId !== userId)
      throw new ForbiddenException("Can only delete your own messages");
    const { aspirantId } = message;
    await this.repo.remove(message);
    this.chatEvents.publish({
      aspirantId,
      type: "message.deleted",
      payload: { id: messageId },
    });
    return { message: "Message deleted" };
  }
}
