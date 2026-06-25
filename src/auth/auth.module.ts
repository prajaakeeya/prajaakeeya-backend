import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { UsersModule } from "../users/users.module";
import { AspirantsModule } from "../aspirants/aspirants.module";
import { WardsModule } from "../wards/wards.module";
import { VotesModule } from "../votes/votes.module";
import { ElectionsModule } from "../elections/elections.module";
import { GeographyModule } from "../geography/geography.module";
import { GramaPanchayatModule } from "../grama-panchayat/grama-panchayat.module";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { S3Service } from "../common/services/s3.service";

@Module({
  imports: [
    ConfigModule,
    UsersModule,
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
          algorithm: "HS256",
          expiresIn: (configService.get<string>("JWT_EXPIRES_IN") || "24h") as any,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    S3Service,
  ],
  exports: [JwtStrategy],
})
export class AuthModule {}
