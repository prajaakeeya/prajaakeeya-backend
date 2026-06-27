import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import type { Cache } from "cache-manager";
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
import * as crypto from "crypto";
import axios from "axios";

/** A freshly issued session: short access token + rotating refresh token. */
export interface SessionResult {
  user: User;
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

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
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  private readonly logger = new Logger(AuthService.name);

  /** One-time OAuth code: cache key prefix and (short) single-use lifetime. */
  private readonly oauthCodeTtlMs = 60 * 1000;
  private oauthCodeKey(code: string): string {
    return `oauth:code:${code}`;
  }

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

  // ===== Session tokens: short-lived access + rotating refresh =====

  private get accessTtl(): string {
    return this.configService.get<string>("JWT_ACCESS_EXPIRES_IN") || "15m";
  }
  private get refreshTtl(): string {
    return this.configService.get<string>("JWT_REFRESH_EXPIRES_IN") || "7d";
  }

  /**
   * Secret for signing/verifying refresh tokens. Uses JWT_REFRESH_SECRET when
   * set; otherwise derives a DISTINCT key from JWT_SECRET so access and refresh
   * tokens never share a signing key — without forcing a new env var into
   * every deployment.
   */
  private refreshSecret(): string {
    const explicit = this.configService.get<string>("JWT_REFRESH_SECRET");
    if (explicit) return explicit;
    return crypto
      .createHash("sha256")
      .update(`${this.requireSecret()}:refresh`)
      .digest("hex");
  }

  private hashRefreshToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  private signAccessToken(user: User): Promise<string> {
    // Access token uses the default JWT_SECRET (so JwtStrategy validates it as
    // today) but a tight expiry — the refresh token carries longevity instead.
    return this.jwtService.signAsync(this.buildJwtPayload(user), {
      expiresIn: this.accessTtl,
    });
  }

  private async signRefreshToken(
    userId: number,
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = await this.jwtService.signAsync(
      { sub: userId, type: "refresh", jti: crypto.randomUUID() },
      { secret: this.refreshSecret(), expiresIn: this.refreshTtl },
    );
    const decoded = this.jwtService.decode(token) as { exp: number };
    return { token, expiresAt: new Date(decoded.exp * 1000) };
  }

  /**
   * Issue a fresh session: a short-lived access token + a new refresh token
   * whose hash replaces any previous one (single active session). Calling this
   * during /auth/refresh is also what ROTATES the refresh token.
   */
  async issueSession(user: User): Promise<SessionResult> {
    const accessToken = await this.signAccessToken(user);
    const { token: refreshToken, expiresAt } = await this.signRefreshToken(
      user.id,
    );
    await this.usersService.setRefreshTokenHash(
      user.id,
      this.hashRefreshToken(refreshToken),
    );
    return { user, accessToken, refreshToken, refreshExpiresAt: expiresAt };
  }

  /**
   * Redeem a refresh token: verify signature + type, confirm it matches the
   * stored hash, then ROTATE (issue a new pair). A syntactically valid but
   * superseded/forged token whose hash doesn't match triggers reuse-detection:
   * the session is revoked so neither party can continue.
   */
  async rotateRefresh(refreshToken: string): Promise<SessionResult> {
    let payload: { sub?: number; type?: string };
    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.refreshSecret(),
        algorithms: ["HS256"],
      });
    } catch {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }
    if (payload.type !== "refresh" || !payload.sub) {
      throw new UnauthorizedException("Invalid refresh token");
    }

    const user = await this.usersService.findById(payload.sub);
    const storedHash = await this.usersService.getRefreshTokenHash(payload.sub);
    if (!user || !storedHash) {
      throw new UnauthorizedException("Session expired");
    }
    if (user.isBlocked) {
      throw new UnauthorizedException("User is blocked");
    }

    const presented = Buffer.from(this.hashRefreshToken(refreshToken));
    const stored = Buffer.from(storedHash);
    if (
      presented.length !== stored.length ||
      !crypto.timingSafeEqual(presented, stored)
    ) {
      // Reuse detection — revoke the whole session.
      await this.usersService.setRefreshTokenHash(payload.sub, null);
      throw new UnauthorizedException("Refresh token revoked");
    }

    return this.issueSession(user);
  }

  /** Revoke the user's refresh session (logout / block). */
  async revokeSession(userId: number): Promise<void> {
    await this.usersService.setRefreshTokenHash(userId, null);
    // Also bump tokenVersion so the short-lived access token is rejected
    // immediately (the strategy reads the new version from cache) rather than
    // surviving until its ~15-min TTL. Best-effort — clearing the refresh hash
    // already stops the session from being renewed.
    await this.usersService.revokeAllSessions(userId).catch(() => undefined);
  }

  /**
   * Verify a refresh token's signature + type and return its subject, or null
   * if missing/invalid/forged/expired. Used by logout: the refresh sub must be
   * VERIFIED (not just decoded) before it drives revocation, otherwise an
   * unauthenticated caller could forge `{ sub: N }` and force a session bump /
   * DB write for any user id.
   */
  async verifyRefreshSub(refreshToken: string): Promise<number | null> {
    try {
      const payload = await this.jwtService.verifyAsync<{
        sub?: number;
        type?: string;
      }>(refreshToken, {
        secret: this.refreshSecret(),
        algorithms: ["HS256"],
      });
      if (payload.type !== "refresh" || !payload.sub) return null;
      return payload.sub;
    } catch {
      return null;
    }
  }

  /**
   * Issue an HMAC-signed CSRF state token for the OAuth round-trip.
   *
   * The frontend's own random state (`clientState`) is embedded and signed so
   * the backend can both (a) verify integrity + freshness on the callback and
   * (b) echo the unchanged client state back, which the frontend compares
   * against the value it stashed in sessionStorage (double-submit CSRF). The
   * client state is hex (no dots), so dot-splitting stays unambiguous.
   */
  issueOAuthState(clientState: string): string {
    const secret = this.requireSecret();
    const ts = Date.now().toString(36);
    const nonce = crypto.randomBytes(12).toString("hex");
    const payload = `${clientState}.${ts}.${nonce}`;
    const sig = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");
    return `${payload}.${sig}`;
  }

  /**
   * Verify an OAuth state token: signature must match and timestamp ≤10 min.
   * Returns the embedded client state when valid, otherwise `null`.
   */
  verifyOAuthState(state: string): string | null {
    const secret = this.requireSecret();
    const parts = state.split(".");
    if (parts.length !== 4) return null;
    const [clientState, ts, nonce, sig] = parts;
    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${clientState}.${ts}.${nonce}`)
      .digest("hex");
    if (
      sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      return null;
    }
    const issuedAt = parseInt(ts, 36);
    if (!Number.isFinite(issuedAt)) return null;
    if (Date.now() - issuedAt >= 10 * 60 * 1000) return null;
    return clientState;
  }

  /**
   * Mint a single-use, short-lived authorization code bound to a freshly
   * issued JWT and the client's OAuth state. Stored server-side (cache) so the
   * JWT never travels in a redirect URL; redeemed exactly once via
   * {@link exchangeOneTimeCode}.
   */
  async createOneTimeCode(token: string, clientState: string): Promise<string> {
    const code = crypto.randomBytes(32).toString("hex");
    await this.cache.set(
      this.oauthCodeKey(code),
      JSON.stringify({ token, state: clientState }),
      this.oauthCodeTtlMs,
    );
    return code;
  }

  /**
   * Redeem a one-time OAuth code. Consumes the code (single use), re-validates
   * the client state, and returns the bound JWT plus the resolved user.
   */
  async exchangeOneTimeCode(
    code: string,
    state: string,
  ): Promise<
    SessionResult & { profile: Awaited<ReturnType<AuthService["profile"]>> }
  > {
    if (!code) {
      throw new BadRequestException("Authorization code is required");
    }
    const key = this.oauthCodeKey(code);
    const raw = await this.cache.get<string>(key);
    if (!raw) {
      throw new UnauthorizedException("Invalid or expired authorization code");
    }
    // Consume immediately so a replayed code cannot be redeemed twice.
    await this.cache.del(key);
    const stored = JSON.parse(raw) as { token: string; state: string };
    if (!state || state !== stored.state) {
      throw new UnauthorizedException("Invalid OAuth state");
    }
    const payload = this.jwtService.decode(stored.token) as { sub?: number };
    const userEntity = payload?.sub
      ? await this.usersService.findById(payload.sub)
      : null;
    if (!userEntity) {
      throw new UnauthorizedException("User not found for authorization code");
    }
    // Mint a real session (access + rotating refresh) at exchange time.
    const session = await this.issueSession(userEntity);
    const profile = await this.profile(userEntity.id);
    return { ...session, profile };
  }

  // ===== Google OAuth 2.0 Authorization Code Flow =====

  /** The frontend URL the OAuth callback redirects back to. */
  getFrontendRedirectUri(): string {
    const frontendRedirect = this.configService.get<string>(
      "GOOGLE_FRONTEND_REDIRECT_URI",
    );
    if (!frontendRedirect) {
      throw new BadRequestException("Google OAuth not configured");
    }
    return frontendRedirect;
  }

  getGoogleAuthUrl(state?: string): string {
    const clientId = this.configService.get<string>("GOOGLE_CLIENT_ID");
    const redirectUri = this.configService.get<string>("GOOGLE_REDIRECT_URI");
    if (!clientId || !redirectUri) {
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

  async handleGoogleCallback(code: string): Promise<{
    token: string;
    user: User;
    errorRedirectUrl?: string;
  }> {
    if (!code) {
      throw new BadRequestException("Authorization code is required");
    }

    const clientId = this.configService.get<string>("GOOGLE_CLIENT_ID");
    const clientSecret = this.configService.get<string>("GOOGLE_CLIENT_SECRET");
    const redirectUri = this.configService.get<string>("GOOGLE_REDIRECT_URI");
    const frontendRedirect = this.configService.get<string>(
      "GOOGLE_FRONTEND_REDIRECT_URI",
    );

    if (!clientId || !clientSecret || !redirectUri || !frontendRedirect) {
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
    } catch (error: unknown) {
      const description = axios.isAxiosError(error)
        ? (error.response?.data as { error_description?: string } | undefined)
            ?.error_description
        : undefined;
      throw new UnauthorizedException(
        description || "Failed to exchange authorization code",
      );
    }

    const accessToken = tokenResponse.data?.access_token;
    if (!accessToken) {
      throw new UnauthorizedException("No access token returned by Google");
    }

    // 2. Fetch user profile
    let profile: {
      email?: string;
      email_verified?: boolean;
      name?: string;
    };
    try {
      const profileResponse = await axios.get<{
        email?: string;
        email_verified?: boolean;
        name?: string;
      }>("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10000,
      });
      profile = profileResponse.data;
    } catch {
      throw new UnauthorizedException("Failed to fetch Google user profile");
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
      const errorMsg = "Your account has been blocked. Please contact support.";
      const errorRedirectUrl = `${frontendRedirect}${sep}error=${encodeURIComponent(errorMsg)}`;
      return { token: "", user, errorRedirectUrl };
    }

    if (
      user &&
      (user.isSelfDeleted || (user.isBlocked && user.name === "Deleted User"))
    ) {
      const reactivated = await this.usersService.reactivateAccount(email, {
        name: profile.name,
        role: "voter",
      });
      if (reactivated) user = reactivated;
    } else if (!user) {
      user = await this.usersService.create({
        email,
        name: profile.name || email.split("@")[0],
        role: "voter",
      });
    }

    // 4. Generate JWT. The caller mints a one-time code bound to this token and
    //    redirects with the code — the JWT itself never enters the URL (a URL
    //    token leaks into server/proxy access logs, browser history and the
    //    Referer header). The code is redeemed via POST /auth/google/exchange,
    //    which sets the httpOnly session cookie. This token is only an identity
    //    carrier consumed within the 60s one-time-code window, so cap it at 5m
    //    instead of inheriting the 24h module default.
    const jwt = await this.jwtService.signAsync(this.buildJwtPayload(user!), {
      expiresIn: "5m",
    });

    return { token: jwt, user: user! };
  }

  // k-Anonymity HIBP check: only the 5-char SHA-1 prefix leaves the process.
  // Returns the number of breach occurrences (0 if not found or API unreachable).
  // Never throws — callers must not block login on HIBP unavailability.
  private async checkPwnedPassword(password: string): Promise<number> {
    const sha1 = crypto
      .createHash("sha1")
      .update(password)
      .digest("hex")
      .toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(
        `https://api.pwnedpasswords.com/range/${prefix}`,
        { signal: controller.signal, headers: { "Add-Padding": "true" } },
      );
      clearTimeout(t);
      if (!res.ok) return 0;
      const text = await res.text();
      for (const line of text.split("\r\n")) {
        const [lineSuffix, count] = line.split(":");
        if (lineSuffix === suffix) return parseInt(count, 10) || 1;
      }
    } catch {
      // HIBP unreachable — fail open so network issues never block admin login.
    }
    return 0;
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
      (await scryptAsync(
        loginDto.password,
        existing.passwordSalt,
        64,
      )) as Buffer
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

    const pwnedCount = await this.checkPwnedPassword(loginDto.password);
    if (pwnedCount > 0) {
      this.logger.warn({
        email: loginDto.email,
        pwnedCount,
        action: "admin.login.pwned_password",
        message: "Admin login with password found in known breach data",
      });
    }

    const session = await this.issueSession(existing);
    if (pwnedCount > 0) {
      return {
        ...session,
        warning: `This password appears in ${pwnedCount.toLocaleString()} known data breach(es). Change it immediately.`,
      };
    }
    return session;
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
    aspirant?: { electionId?: number; constituencyId?: number } | null,
    aspirantElectionType?: string | null,
  ) {
    const aspirantBucketId = (type: string) =>
      aspirantElectionType === type ? (aspirant?.constituencyId ?? null) : null;

    const lokSabhaId =
      user.lokSabhaConstituencyId ?? aspirantBucketId("lok_sabha");
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
    // Fetch the aspirant's election ONCE and reuse it in the `if (aspirant)`
    // block below — avoids a duplicate findById on the same id.
    const aspirantElection = aspirant?.electionId
      ? await this.electionsService
          .findById(aspirant.electionId)
          .catch(() => null)
      : null;
    const aspirantElectionType: string | null = aspirantElection?.type ?? null;
    const savedConstituencies = await this.resolveSavedConstituencies(
      user,
      aspirant,
      aspirantElectionType,
    );

    const result: Record<string, unknown> = { ...user, ...savedConstituencies };

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

      // Reuse the election fetched above (no second findById); only the
      // aspirant's ward still needs loading.
      const election = aspirantElection;
      const aspirantWard = aspirant.wardId
        ? await this.wardsService.findOne(aspirant.wardId).catch(() => null)
        : null;

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
