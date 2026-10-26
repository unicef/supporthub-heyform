import { apollo } from '@/utils'

import {
  ADD_PROJECT_MEMBER_GQL,
  CREATE_PROJECT_GQL,
  DELETE_PROJECT_CODE_GQL,
  DELETE_PROJECT_GQL,
  DELETE_PROJECT_MEMBER_GQL,
  EMPTY_TRASH_GQL,
  LEAVE_PROJECT_GQL,
  RENAME_PROJECT_GQL
} from '@/consts'

export class ProjectService {
  static async create(teamId: string, name: string, memberIds?: string[]) {
    return apollo.mutate({
      mutation: CREATE_PROJECT_GQL,
      variables: {
        input: {
          teamId,
          name,
          memberIds
        }
      }
    })
  }

  static rename(projectId: string, name?: string, memberIds?: string[]) {
    return apollo.mutate({
      mutation: RENAME_PROJECT_GQL,
      variables: {
        input: {
          projectId,
          name,
          memberIds
        }
      }
    })
  }

  static emptyTrash(projectId: string) {
    return apollo.mutate({
      mutation: EMPTY_TRASH_GQL,
      variables: {
        input: {
          projectId
        }
      }
    })
  }

  static deleteCode(projectId: string) {
    return apollo.query<boolean>({
      query: DELETE_PROJECT_CODE_GQL,
      variables: {
        input: {
          projectId
        }
      },
      fetchPolicy: 'network-only'
    })
  }

  static delete(projectId: string, confirmation: { code?: string; name?: string }) {
    return apollo.mutate({
      mutation: DELETE_PROJECT_GQL,
      variables: {
        input: {
          projectId,
          ...confirmation
        }
      }
    })
  }

  static addMember(projectId: string, memberId: string) {
    return apollo.mutate({
      mutation: ADD_PROJECT_MEMBER_GQL,
      variables: {
        input: {
          projectId,
          memberId
        }
      }
    })
  }

  static removeMember(projectId: string, memberId: string) {
    return apollo.mutate({
      mutation: DELETE_PROJECT_MEMBER_GQL,
      variables: {
        input: {
          projectId,
          memberId
        }
      }
    })
  }

  static leave(projectId: string) {
    return apollo.mutate({
      mutation: LEAVE_PROJECT_GQL,
      variables: {
        input: {
          projectId
        }
      }
    })
  }
}
