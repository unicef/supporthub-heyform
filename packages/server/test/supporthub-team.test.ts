import * as assert from 'assert'

import { chooseProvisionTeam } from '../src/utils/supporthub-team'

// One person is first admin of tenants 1, 2 and 3. Tenant 2 provisioned first
// under the old owner-keyed rule, so the owner holds one untagged team named
// after tenant 2.
const LEGACY = { id: 'team-smt', name: 'smt' }

function testSharedFirstAdminGetsSeparateTeams() {
  // The regression: under the owner key, tenants 1 and 3 were handed tenant 2's
  // team. Neither may reuse a team they do not own by tag or by name.
  assert.deepStrictEqual(chooseProvisionTeam([], [LEGACY], '1', 'iawg-fsq'), { kind: 'create' })
  assert.deepStrictEqual(chooseProvisionTeam([], [LEGACY], '3', 'meta'), { kind: 'create' })
}

function testLegacyTeamIsAdoptedByTheTenantThatCreatedIt() {
  assert.deepStrictEqual(chooseProvisionTeam([], [LEGACY], '2', 'smt'), {
    kind: 'adopt',
    teamId: 'team-smt'
  })
}

function testTaggedTeamWinsRegardlessOfOwner() {
  // Lookup is by tag, so a team keeps its tenant even after the first admin
  // changes (the owner's own teams are irrelevant here).
  const tagged = [{ id: 'team-meta', name: 'meta', supporthubTenantRef: '3' }]
  assert.deepStrictEqual(chooseProvisionTeam(tagged, [LEGACY], '3', 'meta'), {
    kind: 'reuse',
    teamId: 'team-meta'
  })
}

function testTaggedTeamOfAnotherTenantIsNeverAdopted() {
  // Same name, but already claimed by a different tenant: not adoptable.
  const owned = [{ id: 'team-x', name: 'meta', supporthubTenantRef: '9' }]
  assert.deepStrictEqual(chooseProvisionTeam([], owned, '3', 'meta'), { kind: 'create' })
}

function run() {
  testSharedFirstAdminGetsSeparateTeams()
  testLegacyTeamIsAdoptedByTheTenantThatCreatedIt()
  testTaggedTeamWinsRegardlessOfOwner()
  testTaggedTeamOfAnotherTenantIsNeverAdopted()
}

if (require.main === module) {
  run()
  // eslint-disable-next-line no-console
  console.log('supporthub-team: ok')
}
