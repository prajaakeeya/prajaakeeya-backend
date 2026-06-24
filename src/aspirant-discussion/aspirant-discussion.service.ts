import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AspirantDiscussionMessage } from "./aspirant-discussion-message.entity";
import { CreateAspirantDiscussionMessageDto } from "./dto/create-aspirant-discussion-message.dto";
import { GetAspirantDiscussionMessagesDto } from "./dto/get-aspirant-discussion-messages.dto";

@Injectable()
export class AspirantDiscussionService {
  constructor(
    @InjectRepository(AspirantDiscussionMessage)
    private readonly messageRepo: Repository<AspirantDiscussionMessage>,
  ) {}

  async createMessage(
    userId: number,
    userRole: string | undefined,
    aspirantId: number,
    dto: CreateAspirantDiscussionMessageDto,
  ) {
    // Only aspirants can send messages
    if (userRole !== "aspirant") {
      throw new ForbiddenException(
        "Only aspirants can post messages in the discussion room",
      );
    }
    const message = this.messageRepo.create({
      content: dto.content,
      userId,
      aspirantId,
    });
    return this.messageRepo.save(message);
  }

  async getMessages(
    wardNumber: string,
    query: GetAspirantDiscussionMessagesDto,
  ) {
    const { page = 1, limit = 50 } = query;
    const skip = (page - 1) * limit;

    // Get all messages from all aspirants in this ward
    const messagesQuery = this.messageRepo
      .createQueryBuilder("message")
      .innerJoinAndSelect("message.user", "user")
      .innerJoinAndSelect("message.aspirant", "aspirant")
      .innerJoinAndSelect("aspirant.ward", "ward")
      .where("ward.number = :wardNumber", { wardNumber })
      .orderBy("message.createdAt", "DESC")
      .skip(skip)
      .take(limit);

    const [messages, total] = await messagesQuery.getManyAndCount();

    // Format messages to include aspirant and ward information
    const formattedMessages = messages.map((message) => ({
      id: message.id,
      content: message.content,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      userId: message.userId,
      aspirantId: message.aspirantId,
      user: {
        id: message.user?.id,
        name: message.user?.name,
        role: message.user?.role,
      },
      aspirant: {
        id: message.aspirant?.id,
        name: message.aspirant?.name,
        party: message.aspirant?.party,
      },
      ward: {
        id: message.aspirant?.ward?.id,
        number: message.aspirant?.ward?.number,
        name: message.aspirant?.ward?.name,
      },
    }));

    return {
      data: formattedMessages,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async deleteMessage(
    messageId: number,
    userId: number,
    userRole: string | undefined,
  ) {
    const message = await this.messageRepo.findOne({
      where: { id: messageId },
    });

    if (!message) {
      throw new NotFoundException("Message not found");
    }

    // Only the message author or an admin can delete
    if (message.userId !== userId && userRole !== "admin") {
      throw new ForbiddenException("You can only delete your own messages");
    }

    await this.messageRepo.remove(message);
    return { message: "Message deleted successfully" };
  }
}
