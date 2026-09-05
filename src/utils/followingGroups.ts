// 仅用于界面分组，绝不能传给 B 站的分组管理接口。
export const WHISPER_GROUP_ID = -1000

export interface FollowingRelationUser {
  mid: number
  uname: string
  face: string
  mtime: number
  tag: number[] | null
  special: number
  attribute: number
}

export interface WhisperFollowingsResult {
  code: number
  message: string
  data?: { list: FollowingRelationUser[] | null, total?: number }
}

export interface FollowingGroup {
  tagid: number
  name: string
  count: number
  tip: string
}

export interface FollowingGroupsResult {
  code: number
  message: string
  data?: FollowingGroup[]
}

export function getFollowingGroupIds(tags: number[] | null, special: number): number[] {
  if (tags?.includes(WHISPER_GROUP_ID))
    return [WHISPER_GROUP_ID]
  const ids = new Set(tags ?? [])
  // 特别关注独立于普通分组；仅特别关注的用户仍属于默认分组。
  if (![...ids].some(id => id >= 0))
    ids.add(0)
  if (special === 1)
    ids.add(-10)
  return [...ids]
}

/** Put the default group last, preserving other groups' and uploaders' relative order. */
export function groupFollowingUploaders<T extends { groupIds: number[] }>(
  uploaders: T[],
  groups: FollowingGroup[],
  fallbackName: (id: number) => string,
) {
  const grouped = new Map(groups.map(group => [group.tagid, { ...group, uploaders: [] as T[] }]))
  grouped.set(WHISPER_GROUP_ID, {
    tagid: WHISPER_GROUP_ID,
    name: fallbackName(WHISPER_GROUP_ID),
    count: 0,
    tip: '',
    uploaders: [],
  })
  for (const uploader of uploaders) {
    for (const id of uploader.groupIds) {
      let group = grouped.get(id)
      // Keep members visible if a group was created between the two API requests.
      if (!group) {
        group = { tagid: id, name: fallbackName(id), count: 0, tip: '', uploaders: [] }
        grouped.set(id, group)
      }
      group.uploaders.push(uploader)
    }
  }
  return [...grouped.values()].sort((a, b) => Number(a.tagid === 0) - Number(b.tagid === 0))
}
