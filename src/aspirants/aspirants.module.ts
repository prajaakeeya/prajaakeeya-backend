import { Module, forwardRef } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Aspirant } from "./aspirant.entity";
import { AspirantMeeting } from "./aspirant-meeting.entity";
import { AspirantBooking } from "./aspirant-booking.entity";
import { AspirantVisit } from "./aspirant-visit.entity";
import { VisitResponse } from "./visit-response.entity";
import { MeetingResponse } from "./meeting-response.entity";
import { ActivityRating } from "./activity-rating.entity";
import { AspirantProposal } from "./aspirant-proposal.entity";
import { ProposalSupport } from "./proposal-support.entity";
import { AspirantCandidacy } from "./aspirant-candidacy.entity";
import { UserAspirantInteraction } from "../users/user-aspirant-interaction.entity";
import { VotesModule } from "../votes/votes.module";
import { AspirantsService } from "./aspirants.service";
import { AspirantsController } from "./aspirants.controller";
import { UsersModule } from "../users/users.module";
import { WardsModule } from "../wards/wards.module";
import { ElectionsModule } from "../elections/elections.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Aspirant,
      AspirantMeeting,
      AspirantBooking,
      AspirantVisit,
      VisitResponse,
      MeetingResponse,
      ActivityRating,
      UserAspirantInteraction,
      AspirantProposal,
      ProposalSupport,
      AspirantCandidacy,
    ]),
    UsersModule,
    WardsModule,
    ElectionsModule,
    NotificationsModule,
    forwardRef(() => VotesModule),
  ],
  providers: [AspirantsService],
  controllers: [AspirantsController],
  exports: [AspirantsService],
})
export class AspirantsModule {}
