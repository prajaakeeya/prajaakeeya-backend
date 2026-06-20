import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { UsersModule } from "../users/users.module";
import { AspirantsModule } from "../aspirants/aspirants.module";
import { VoterRollModule } from "../voter-roll/voter-roll.module";
import { WardsModule } from "../wards/wards.module";
import { VotesModule } from "../votes/votes.module";
import { ElectionsModule } from "../elections/elections.module";
import { GeographyModule } from "../geography/geography.module";
import { GramaPanchayatModule } from "../grama-panchayat/grama-panchayat.module";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Otp } from "./otp.entity";
import { User } from "../users/user.entity";
import { SESService } from "../common/services/ses.service";
import { S3Service } from "../common/services/s3.service";
import { MessageCentralService } from "../common/services/message-central.service";

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Otp, User]),
    UsersModule,
    VoterRollModule,
    WardsModule,
    AspirantsModule,
    VotesModule,
    ElectionsModule,
    GeographyModule,
    GramaPanchayatModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>("JWT_SECRET"),
        signOptions: {
          expiresIn: configService.get<string>("JWT_EXPIRES_IN") || "24h",
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    SESService,
    S3Service,
    MessageCentralService,
  ],
  exports: [JwtStrategy],
})
export class AuthModule {}
