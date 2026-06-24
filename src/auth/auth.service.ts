import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { UsersService } from "../users/users.service";
import { VotesService } from "../votes/votes.service";
import { WardsService } from "../wards/wards.service";
import { AspirantsService } from "../aspirants/aspirants.service";
import { ElectionsService } from "../elections/elections.service";
import { ParliamentaryService } from "../geography/parliamentary.service";
import { AssemblyService } from "../geography/assembly.service";
import { GramaPanchayatService } from "../grama-panchayat/grama-panchayat.service";
import { S3Service } from "../common/services/s3.service";
import { LoginDto } from "./dto/login.dto";
import { User } from "../users/user.entity";
import axios from "axios";

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly wardsService: WardsService,
    private readonly aspirantsService: AspirantsService,
    private readonly votesService: VotesService,
    private readonly s3Service: S3Service,
    private readonly electionsService: ElectionsService,
    private readonly parliamentaryService: ParliamentaryService,
    private readonly assemblyService: AssemblyService,
    private readonly gramaPanchayatService: GramaPanchayatService,
    private readonly configService: ConfigService,
  ) {}

  /** Build the JWT payload — includes the fields the strategy/guards rely on. */
  private buildJwtPayload(user: User) {
    return {
      sub: user.id,
      role: user.role,
      wardId: user.wardId,
      isBlocked: user.isBlocked,
      tokenVersion: user.tokenVersion ?? 0,
    };
  }

  /**
   * Read JWT_SECRET or fail closed. Never fall back to a public constant — a
   * predictable secret would let an attacker forge OAuth CSRF-state tokens.
   */
  private requireSecret(): string {
    const secret = this.configService.get<string>("JWT_SECRET");
    if (!secret) {
      throw new Error("JWT_SECRET is not configured");
    }
    return secret;
  }

  /** Issue a stateless HMAC-signed CSRF state token for the OAuth round-trip. */
  issueOAuthState(): string {
    const secret = this.requireSecret();
    const crypto = require("crypto") as typeof import("crypto");
    const ts = Date.now().toString(36);
    const nonce = crypto.randomBytes(12).toString("hex");
    const payload = `${ts}.${nonce}`;
    const sig = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");
    return `${payload}.${sig}`;
  }

  /** Verify an OAuth state token: signature must match and timestamp ≤10 min. */
  verifyOAuthState(state: string): boolean {
    const secret = this.requireSecret();
    const crypto = require("crypto") as typeof import("crypto");
    const parts = state.split(".");
    if (parts.length !== 3) return false;
    const [ts, nonce, sig] = parts;
    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${ts}.${nonce}`)
      .digest("hex");
    if (
      sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      return false;
    }
    const issuedAt = parseInt(ts, 36);
    if (!Number.isFinite(issuedAt)) return false;
    return Date.now() - issuedAt < 10 * 60 * 1000;
  }

  // ===== Google OAuth 2.0 Authorization Code Flow =====

  /**
   * Dev-only bypass for the real Google OAuth token exchange. Hard-gated to
   * non-production so a stray env var can never enable it on a live server.
   */
  private isMockOAuthEnabled(): boolean {
    return (
      this.configService.get<string>("GOOGLE_OAUTH_MOCK") === "true" &&
      this.configService.get<string>("NODE_ENV") !== "production"
    );
  }

  /** A fresh fake Google profile — used the first time, or when a fresh identity is requested. */
  private generateMockProfile(): { email: string; name: string; email_verified: true } {
    const firstNames = ["Asha", "Ravi", "Priya", "Karthik", "Meera", "Vikram", "Divya", "Suresh"];
    const lastNames = ["Rao", "Kumar", "Nair", "Gowda", "Reddy", "Iyer", "Shetty", "Patil"];
    const first = firstNames[Math.floor(Math.random() * firstNames.length)];
    const last = lastNames[Math.floor(Math.random() * lastNames.length)];
    const suffix = require("crypto").randomBytes(4).toString("hex");
    return {
      email: `${first.toLowerCase()}.${last.toLowerCase()}.${suffix}@mock.test`,
      name: `${first} ${last}`,
      email_verified: true,
    };
  }

  /**
   * Resolve the mock identity for this browser: reuse the one stored in the
   * `mock_identity` cookie (so a relogin after JWT expiry comes back as the
   * same fake person), unless none exists yet or a fresh one was explicitly
   * requested (`/auth/google?fresh=1`) — e.g. for testing multiple accounts.
   * Returns the profile plus the (plain, not pre-encoded — res.cookie()
   * handles that) cookie value the controller should set.
   */
  private resolveMockProfile(
    existingCookieJson?: string,
    forceFresh?: boolean,
  ): { profile: { email: string; name: string; email_verified: true }; cookieValue: string } {
    if (!forceFresh && existingCookieJson) {
      try {
        const parsed = JSON.parse(existingCookieJson);
        if (typeof parsed?.email === "string" && typeof parsed?.name === "string") {
          return {
            profile: { ...parsed, email_verified: true },
            cookieValue: existingCookieJson,
          };
        }
      } catch {
        /* fall through to generating a fresh one */
      }
    }
    const profile = this.generateMockProfile();
    return {
      profile,
      cookieValue: JSON.stringify({ email: profile.email, name: profile.name }),
    };
  }

  getGoogleAuthUrl(state?: string, fresh?: boolean): string {
    const redirectUri = this.configService.get<string>("GOOGLE_REDIRECT_URI");
    if (!redirectUri) {
      throw new BadRequestException("Google OAuth not configured");
    }

    if (this.isMockOAuthEnabled()) {
      // Skip Google entirely — redirect straight back to our own callback
      // with a synthetic code, so the rest of the pipeline (state
      // verification, user creation, JWT issuance) is exercised unchanged.
      const params = new URLSearchParams({ code: "mock" });
      if (state) params.set("state", state);
      if (fresh) params.set("fresh", "1");
      return `${redirectUri}?${params.toString()}`;
    }

    const clientId = this.configService.get<string>("GOOGLE_CLIENT_ID");
    if (!clientId) {
      throw new BadRequestException("Google OAuth not configured");
    }
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    });
    if (state) params.set("state", state);
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async handleGoogleCallback(
    code: string,
    mockIdentityCookie?: string,
    forceFreshMockIdentity?: boolean,
  ): Promise<{
    token: string;
    user: User;
    redirectUrl: string;
    mockIdentityCookie?: string;
  }> {
    if (!code) {
      throw new BadRequestException("Authorization code is required");
    }

    const frontendRedirect = this.configService.get<string>(
      "GOOGLE_FRONTEND_REDIRECT_URI",
    );
    if (!frontendRedirect) {
      throw new BadRequestException("Google OAuth not configured");
    }

    const mockEnabled = this.isMockOAuthEnabled();

    let profile: any;
    let mockIdentityCookieToSet: string | undefined;
    if (mockEnabled) {
      // Dev-only bypass — see isMockOAuthEnabled(). Skips Google's token
      // exchange and userinfo lookup, but every step after this (find/create
      // user, JWT issuance, redirect) is identical to the real flow. Reuses
      // the same fake identity across relogins (e.g. after JWT expiry) via
      // the mock_identity cookie, unless a fresh one was requested.
      const resolved = this.resolveMockProfile(
        mockIdentityCookie,
        forceFreshMockIdentity,
      );
      profile = resolved.profile;
      mockIdentityCookieToSet = resolved.cookieValue;
    } else {
      const clientId = this.configService.get<string>("GOOGLE_CLIENT_ID");
      const clientSecret = this.configService.get<string>("GOOGLE_CLIENT_SECRET");
      const redirectUri = this.configService.get<string>("GOOGLE_REDIRECT_URI");
      if (!clientId || !clientSecret || !redirectUri) {
        throw new BadRequestException("Google OAuth not configured");
      }

      // 1. Exchange code for tokens
      let tokenResponse;
      try {
        tokenResponse = await axios.post(
          "https://oauth2.googleapis.com/token",
          new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
          }).toString(),
          {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            timeout: 10000,
          },
        );
      } catch (error: any) {
        throw new UnauthorizedException(
          error.response?.data?.error_description ||
            "Failed to exchange authorization code",
        );
      }

      const accessToken = tokenResponse.data?.access_token;
      if (!accessToken) {
        throw new UnauthorizedException("No access token returned by Google");
      }

      // 2. Fetch user profile
      try {
        const profileResponse = await axios.get(
          "https://www.googleapis.com/oauth2/v3/userinfo",
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 10000,
          },
        );
        profile = profileResponse.data;
      } catch (error: any) {
        throw new UnauthorizedException("Failed to fetch Google user profile");
      }
    }

    const email: string | undefined = profile?.email;
    if (!email) {
      throw new UnauthorizedException("Email not provided by Google");
    }
    if (profile.email_verified === false) {
      throw new UnauthorizedException("Google email is not verified");
    }

    // 3. Find or create user
    let user = await this.usersService.findByEmail(email);

    if (user && user.isBlocked && user.name !== "Deleted User") {
      const sep = frontendRedirect.includes("?") ? "&" : "?";
      const errorMsg =
        "Your account has been blocked. Please contact support.";
      const redirectUrl = `${frontendRedirect}${sep}error=${encodeURIComponent(errorMsg)}`;
      return { token: "", user, redirectUrl, mockIdentityCookie: mockIdentityCookieToSet };
    }

    if (user && (user.isSelfDeleted || (user.isBlocked && user.name === "Deleted User"))) {
      const reactivated = await this.usersService.reactivateAccount(email, {
        name: profile.name,
        role: "voter",
      } as any);
      if (reactivated) user = reactivated;
    } else if (!user) {
      user = await this.usersService.create({
        email,
        name: profile.name || email.split("@")[0],
        role: "voter",
      } as any);
    }

    // 4. Generate JWT
    const jwt = await this.jwtService.signAsync(this.buildJwtPayload(user!));

    // 5. Build redirect URL back to the app with token
    const sep = frontendRedirect.includes("?") ? "&" : "?";
    const redirectUrl = `${frontendRedirect}${sep}token=${encodeURIComponent(jwt)}`;

    return { token: jwt, user: user!, redirectUrl, mockIdentityCookie: mockIdentityCookieToSet };
  }

  async adminLogin(loginDto: LoginDto) {
    if (!loginDto.email) {
      throw new UnauthorizedException("Email required for admin login");
    }
    const existing = await this.usersService.findByEmail(loginDto.email);
    if (!existing || existing.role !== "admin") {
      throw new UnauthorizedException("Admin not registered");
    }

    // Expect password for admin login
    if (!loginDto.password) {
      throw new UnauthorizedException("Password required for admin login");
    }

    // Verify password using stored salt/hash
    if (!existing.passwordSalt || !existing.passwordHash) {
      throw new UnauthorizedException("Admin has no password set");
    }
    const crypto = await import("crypto");
    const { promisify } = await import("util");
    const scryptAsync = promisify(crypto.scrypt);
    const hash = (
      (await scryptAsync(loginDto.password, existing.passwordSalt, 64)) as Buffer
    ).toString("hex");
    // Constant-time comparison so login latency can't leak how many leading
    // bytes of the hash matched.
    const actual = Buffer.from(hash, "hex");
    const expected = Buffer.from(existing.passwordHash, "hex");
    if (
      actual.length !== expected.length ||
      !crypto.timingSafeEqual(actual, expected)
    ) {
      throw new UnauthorizedException("Invalid admin credentials");
    }

    const payload = this.buildJwtPayload(existing);
    return { token: await this.jwtService.signAsync(payload), user: existing };
  }

  /**
   * Resolve the four constituency IDs the user saved on their profile
   * (lok_sabha / state_assembly / municipal_corporation / gram_panchayat)
   * into human-friendly names plus their parent hierarchy. For a ward
   * (municipal corporation) this is the ward name + municipality (e.g.
   * "Greater Bengaluru Authority(GBA) – Bengaluru"); for a village
   * (gram panchayat) it's the village + GP + taluk + district.
   *
   * If the user is an aspirant, their aspirant record's election +
   * constituency act as a fallback for whichever bucket their election
   * type maps to — so the response still shows the right hierarchy even
   * when the user-level saved IDs haven't been set.
   *
   * Failures on any single lookup don't block the others — the caller
   * just gets `null` for that field's name.
   */
  private async resolveSavedConstituencies(
    user: User,
    aspirant?: { electionId?: number | null; constituencyId?: number | null } | null,
    aspirantElectionType?: string | null,
  ) {
    const aspirantBucketId = (type: string) =>
      aspirantElectionType === type ? (aspirant?.constituencyId ?? null) : null;

    const lokSabhaId = user.lokSabhaConstituencyId ?? aspirantBucketId("lok_sabha");
    const stateAssemblyId =
      user.stateAssemblyConstituencyId ?? aspirantBucketId("state_assembly");
    const wardId =
      user.municipalCorporationConstituencyId ??
      aspirantBucketId("municipal_corporation");
    const villageId =
      user.gramPanchayatConstituencyId ?? aspirantBucketId("gram_panchayat");

    const [lokSabha, stateAssembly, ward, village] = await Promise.all([
      lokSabhaId
        ? this.parliamentaryService.findOne(lokSabhaId).catch(() => null)
        : Promise.resolve(null),
      stateAssemblyId
        ? this.assemblyService.findOne(stateAssemblyId).catch(() => null)
        : Promise.resolve(null),
      wardId
        ? this.wardsService.findOne(wardId).catch(() => null)
        : Promise.resolve(null),
      villageId
        ? this.gramaPanchayatService.findBySrNo(villageId).catch(() => null)
        : Promise.resolve(null),
    ]);

    return {
      lokSabhaConstituency: lokSabha
        ? { id: lokSabha.id, name: lokSabha.name, state: lokSabha.state }
        : null,
      stateAssemblyConstituency: stateAssembly
        ? {
            id: stateAssembly.id,
            name: stateAssembly.name,
            state: stateAssembly.state,
            parliamentary: stateAssembly.parliamentary,
          }
        : null,
      municipalCorporationConstituency: ward
        ? {
            id: ward.id,
            number: ward.number,
            name: ward.name,
            municipality: ward.municipality,
            zone: ward.zone,
            assembly: ward.assembly,
            parliamentary: ward.parliamentary,
            state: ward.state,
            category: ward.category ?? null,
          }
        : null,
      gramPanchayatConstituency: village
        ? {
            srNo: Number(village.srNo),
            villageName: village.villageName,
            gpName: village.gpName,
            taluk: village.taluk,
            district: village.district,
            state: village.state,
          }
        : null,
    };
  }

  async profile(userId: number) {
    const user = await this.usersService.findById(userId);
    if (!user || user.isSelfDeleted) return null;

    // Run independent lookups concurrently. The aspirant lookup is only
    // meaningful for aspirant users; others get undefined.
    const [aspirant, ward, hasVoted] = await Promise.all([
      user.role === "aspirant"
        ? this.aspirantsService.findByUserId(user.id).catch(() => null)
        : Promise.resolve(null),
      user.wardId
        ? this.wardsService.findOne(user.wardId).catch(() => null)
        : Promise.resolve(null),
      this.votesService.hasUserVotedInActiveWindow(user.id).catch(() => false),
    ]);

    // Resolve the aspirant's election type once so the saved-constituency
    // helper can use the aspirant record as a fallback when the user's
    // own constituency IDs are unset.
    let aspirantElectionType: string | null = null;
    if (aspirant?.electionId) {
      const election = await this.electionsService
        .findById(aspirant.electionId)
        .catch(() => null);
      aspirantElectionType = election?.type ?? null;
    }
    const savedConstituencies = await this.resolveSavedConstituencies(
      user,
      aspirant,
      aspirantElectionType,
    );

    const result: any = { ...user, ...savedConstituencies };

    // The four raw *ConstituencyId fields are redundant once the resolved
    // *Constituency objects are present (FE can read e.g.
    // municipalCorporationConstituency?.id). Drop them to keep the payload
    // single-sourced.
    delete result.lokSabhaConstituencyId;
    delete result.stateAssemblyConstituencyId;
    delete result.municipalCorporationConstituencyId;
    delete result.gramPanchayatConstituencyId;

    // Never serialize credential material to the client.
    delete result.passwordHash;
    delete result.passwordSalt;

    if (ward) {
      result.wardNumber = ward.number;
      result.state = ward.state ?? result.state;
      result.parliamentary = ward.parliamentary ?? result.parliamentary;
      result.assembly = ward.assembly ?? result.assembly;
      result.category = ward.category ?? result.category ?? null;
    }

    if (aspirant) {
      result.aspirantId = aspirant.id;
      result.electionId = aspirant.electionId ?? null;
      result.constituencyId = aspirant.constituencyId ?? null;
      try {
        result.documentStatus = aspirant.getDocumentStatus();
      } catch {
        /* method unavailable */
      }
      result.allowPhone = aspirant.allowPhone;
      result.allowWhatsapp = aspirant.allowWhatsapp;
      result.allowChat = aspirant.allowChat;

      // Resolve election/constituency/aspirant-ward in parallel.
      const [election, aspirantWard] = await Promise.all([
        aspirant.electionId
          ? this.electionsService.findById(aspirant.electionId).catch(() => null)
          : Promise.resolve(null),
        aspirant.wardId
          ? this.wardsService.findOne(aspirant.wardId).catch(() => null)
          : Promise.resolve(null),
      ]);

      if (election) {
        result.electionName = election.name;
        result.electionType = election.type;
        if (aspirant.constituencyId) {
          try {
            if (election.type === "lok_sabha") {
              const pc = await this.parliamentaryService.findOne(
                aspirant.constituencyId,
              );
              result.constituencyName = pc.name;
            } else if (election.type === "state_assembly") {
              const ac = await this.assemblyService.findOne(
                aspirant.constituencyId,
              );
              result.constituencyName = ac.name;
            } else if (election.type === "municipal_corporation") {
              const w = await this.wardsService.findOne(
                aspirant.constituencyId,
              );
              result.constituencyName = `${w.number} - ${w.name}`;
            } else if (election.type === "gram_panchayat") {
              const village = await this.gramaPanchayatService.findBySrNo(
                aspirant.constituencyId,
              );
              result.constituencyName = village.villageName;
              result.gpName = village.gpName;
              result.taluk = village.taluk;
              result.district = village.district;
            }
          } catch {
            /* ignore */
          }
        }
      }

      if (aspirantWard) {
        result.aspirantWardNumber = aspirantWard.number;
        if (!result.wardNumber) result.wardNumber = aspirantWard.number;
      }
    }

    result.hasVoted = hasVoted;
    return result;
  }
}
