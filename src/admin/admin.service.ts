import { Injectable } from "@nestjs/common";
import { WardsService } from "../wards/wards.service";
import { AspirantsService } from "../aspirants/aspirants.service";
import { VotesService } from "../votes/votes.service";
import { UsersService } from "../users/users.service";
import { ElectionsService } from "../elections/elections.service";
import { ParliamentaryService } from "../geography/parliamentary.service";
import { AssemblyService } from "../geography/assembly.service";
import { MunicipalityService } from "../geography/municipality.service";
import { UpdateUserDto } from "../users/dto/update-user.dto";
import { CreateWardMeetingDto } from "../wards/dto/create-ward-meeting.dto";
import { UpdateWardMeetingDto } from "../wards/dto/update-ward-meeting.dto";
import { SetVotingWindowDto } from "../votes/dto/set-voting-window.dto";
import { CreateElectionDto } from "../elections/dto/create-election.dto";
import { UpdateElectionDto } from "../elections/dto/update-election.dto";
import { CreateParliamentaryDto } from "../geography/dto/create-parliamentary.dto";
import { CreateAssemblyDto } from "../geography/dto/create-assembly.dto";
import { CreateMunicipalityDto } from "../geography/dto/create-municipality.dto";
import { CreateWardDto } from "../wards/dto/create-ward.dto";
import { GramaPanchayatService } from "../grama-panchayat/grama-panchayat.service";
import { CreateGramaPanchayatDto } from "../grama-panchayat/dto/create-grama-panchayat.dto";

@Injectable()
export class AdminService {
  constructor(
    private readonly wardsService: WardsService,
    private readonly aspirantsService: AspirantsService,
    private readonly votesService: VotesService,
    private readonly usersService: UsersService,
    private readonly electionsService: ElectionsService,
    private readonly parliamentaryService: ParliamentaryService,
    private readonly assemblyService: AssemblyService,
    private readonly municipalityService: MunicipalityService,
    private readonly gramaPanchayatService: GramaPanchayatService,
  ) {}

  async dashboard() {
    const [wards, aspirants, votes, citizens] = await Promise.all([
      this.wardsService.findAll(),
      this.aspirantsService.count(),
      this.votesService.count(),
      this.usersService.countRegistered(),
    ]);
    return { totals: { wards: wards.length, aspirants, votes, citizens } };
  }

  async getAllReports(status?: string, page?: number, limit?: number) {
    return this.usersService.getAllReports(status, page, limit);
  }

  async getReportById(id: number) {
    return this.usersService.getReportById(id);
  }

  async updateReportStatus(
    id: number,
    status: "pending" | "resolved" | "rejected",
    adminNotes?: string,
    resolvedById?: number,
  ) {
    return this.usersService.updateReportStatus(
      id,
      status,
      adminNotes,
      resolvedById,
    );
  }

  // User Management
  async getAllUsers() {
    return this.usersService.getAllUsers();
  }

  async getUserById(id: number) {
    return this.usersService.getUserById(id);
  }

  async updateUser(id: number, dto: UpdateUserDto) {
    return this.usersService.updateUser(id, dto);
  }

  async blockUser(id: number) {
    return this.usersService.blockUser(id);
  }

  async unblockUser(id: number) {
    return this.usersService.unblockUser(id);
  }

  async deleteUser(id: number) {
    return this.usersService.deleteUser(id);
  }

  async getUsersByWard(wardId: number, page?: number, limit?: number) {
    return this.usersService.getUsersByWard(wardId, page, limit);
  }

  // Ward Meeting Management
  async createMeeting(dto: CreateWardMeetingDto, createdById: number) {
    return this.wardsService.createMeeting(dto, createdById);
  }

  async getAllMeetings(wardNumber?: string, isActive?: boolean) {
    if (wardNumber) {
      // Resolve ward number to ward id
      const ward = await this.wardsService.findByNumber(wardNumber);
      return this.wardsService.getAllMeetings(ward.id, isActive);
    }
    return this.wardsService.getAllMeetings(undefined, isActive);
  }

  async getMeetingById(id: number) {
    return this.wardsService.getMeetingById(id);
  }

  async updateMeeting(id: number, dto: UpdateWardMeetingDto) {
    return this.wardsService.updateMeeting(id, dto);
  }

  async deleteMeeting(id: number) {
    return this.wardsService.deleteMeeting(id);
  }

  // Election Management
  async createElection(dto: CreateElectionDto) {
    return this.electionsService.createElection(dto);
  }

  async updateElection(id: number, dto: UpdateElectionDto) {
    return this.electionsService.updateElection(id, dto);
  }

  // DELETE disabled per request — commented, not removed. Destructive deletion
  // of reference data (audit C3 / the election-deletion incident). Re-enable
  // only with admin RBAC + soft-delete + audit logging.
  // async deleteElection(id: number) {
  //   return this.electionsService.deleteElection(id);
  // }

  // Parliamentary Constituency Management
  async createParliamentary(dto: CreateParliamentaryDto) {
    return this.parliamentaryService.create(dto);
  }

  async updateParliamentary(id: number, dto: Partial<CreateParliamentaryDto>) {
    return this.parliamentaryService.update(id, dto);
  }

  // DELETE disabled per request — commented, not removed (audit C3).
  // async deleteParliamentary(id: number) {
  //   return this.parliamentaryService.delete(id);
  // }

  // Assembly Constituency Management
  async createAssembly(dto: CreateAssemblyDto) {
    return this.assemblyService.create(dto);
  }

  async updateAssembly(id: number, dto: Partial<CreateAssemblyDto>) {
    return this.assemblyService.update(id, dto);
  }

  // DELETE disabled per request — commented, not removed (audit C3).
  // async deleteAssembly(id: number) {
  //   return this.assemblyService.delete(id);
  // }

  // Municipality Management
  async getMunicipalities(state?: string) {
    return this.municipalityService.findAll(state);
  }

  async createMunicipality(dto: CreateMunicipalityDto) {
    return this.municipalityService.create(dto);
  }

  async updateMunicipality(id: number, dto: Partial<CreateMunicipalityDto>) {
    return this.municipalityService.update(id, dto);
  }

  // DELETE disabled per request — commented, not removed (audit C3).
  // async deleteMunicipality(id: number) {
  //   return this.municipalityService.delete(id);
  // }

  // Ward Management
  async createWard(dto: CreateWardDto) {
    return this.wardsService.create(dto);
  }

  async updateWard(id: number, dto: Partial<CreateWardDto>) {
    return this.wardsService.update(id, dto);
  }

  // DELETE disabled per request — commented, not removed (audit C3).
  // async deleteWard(id: number) {
  //   return this.wardsService.delete(id);
  // }

  // Grama Panchayat Management
  async createGramaPanchayat(dto: CreateGramaPanchayatDto) {
    return this.gramaPanchayatService.create(dto);
  }

  async updateGramaPanchayat(
    id: number,
    dto: Partial<CreateGramaPanchayatDto>,
  ) {
    return this.gramaPanchayatService.update(id, dto);
  }

  async deleteGramaPanchayat(id: number) {
    return this.gramaPanchayatService.delete(id);
  }

  // Voting Window Management
  async setVotingWindow(dto: SetVotingWindowDto) {
    return this.votesService.setVotingWindow(dto);
  }

  async getActiveVotingWindow() {
    return this.votesService.getActiveVotingWindow();
  }

  async getAllVotingWindows() {
    return this.votesService.getAllVotingWindows();
  }
}
