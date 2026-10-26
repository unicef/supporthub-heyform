import { BadRequestException } from '@nestjs/common'

import { Auth, Project, ProjectGuard, Team } from '@decorator'
import { ProjectMemberInput } from '@graphql'
import { TeamRoleEnum } from '@model'
import { ProjectModel, TeamModel } from '@model'
import { Args, Mutation, Resolver } from '@nestjs/graphql'
import { ProjectService, TeamService } from '@service'

@Resolver()
@Auth()
export class AddProjectMemberResolver {
  constructor(
    private readonly projectService: ProjectService,
    private readonly teamService: TeamService
  ) {}

  @ProjectGuard()
  @Mutation(returns => Boolean)
  async addProjectMember(
    @Team() team: TeamModel,
    @Project() project: ProjectModel,
    @Args('input') input: ProjectMemberInput
  ): Promise<boolean> {
    const canManageMembers =
      team.isOwner ||
      project.isOwner ||
      (team as TeamModel & { role?: TeamRoleEnum }).role === TeamRoleEnum.OWNER ||
      (team as TeamModel & { role?: TeamRoleEnum }).role === TeamRoleEnum.ADMIN

    if (!canManageMembers) {
      throw new BadRequestException("You don't have permission to manage project members")
    }

    const teamMember = await this.teamService.findMemberById(team.id, input.memberId)

    if (!teamMember) {
      throw new BadRequestException('The member does not belong to this workspace')
    }

    const member = await this.projectService.findMemberById(input.projectId, input.memberId)

    if (member) {
      throw new BadRequestException('The member already exists in this project')
    }

    return this.projectService.createMember({
      projectId: input.projectId,
      memberId: input.memberId
    })
  }
}
