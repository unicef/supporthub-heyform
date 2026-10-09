/**
 * Which team `/api/provision` should use for a SupportHub tenant.
 *
 * The key is the tenant (`tenantRef`), never the owner: one person is often the
 * first admin of several tenants, and keying on the owner put those tenants in
 * one shared team.
 *
 * Teams provisioned before the tag existed carry no `supporthubTenantRef`. Such
 * a team is adopted only when it is the owner's untagged team named after this
 * tenant (provision names a new team `tenantName`), so a legacy shared team is
 * kept by the tenant that created it and every other tenant gets its own.
 */

export interface ProvisionTeamCandidate {
  // Optional only because mongoose types `id` as optional on documents.
  id?: string
  name: string
  supporthubTenantRef?: string
}

export type ProvisionTeamChoice =
  | { kind: 'reuse'; teamId: string }
  | { kind: 'adopt'; teamId: string }
  | { kind: 'create' }

export function chooseProvisionTeam(
  tagged: ProvisionTeamCandidate[],
  ownedTeams: ProvisionTeamCandidate[],
  tenantRef: string,
  tenantName: string
): ProvisionTeamChoice {
  const exact = tagged.find(team => team.supporthubTenantRef === tenantRef)
  if (exact) {
    return { kind: 'reuse', teamId: exact.id }
  }

  const legacy = ownedTeams.find(team => !team.supporthubTenantRef && team.name === tenantName)
  if (legacy) {
    return { kind: 'adopt', teamId: legacy.id }
  }

  return { kind: 'create' }
}
