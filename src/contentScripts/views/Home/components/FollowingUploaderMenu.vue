<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'

import type { ContextMenuOption } from '~/components/ContextMenu.vue'
import ContextMenu from '~/components/ContextMenu.vue'
import Dialog from '~/components/Dialog.vue'
import api from '~/utils/api'
import type { FollowingGroup, FollowingGroupsResult } from '~/utils/followingGroups'
import { WHISPER_GROUP_ID } from '~/utils/followingGroups'
import { getCSRF } from '~/utils/main'

interface Uploader {
  mid: number
  name: string
  groupIds: number[]
}

const emit = defineEmits<{
  (event: 'unfollowed', mid: number): void
  (event: 'groupsChanged', mid: number, groupIds: number[]): void
  (event: 'groupsLoaded', groups: FollowingGroup[]): void
}>()

const { t } = useI18n()
const toast = useToast()
const target = ref<Uploader>()
const cursorPosition = ref({ x: 0, y: 0 })
const menuVisible = ref(false)
const groupMenuVisible = ref(false)
const confirmVisible = ref(false)
const confirmedAction = ref<'unfollow' | 'unwhisper'>('unfollow')
const busy = ref(false)
const groups = ref<FollowingGroup[]>([])
let revision = 0
let disposed = false

const isWhisper = computed(() => target.value?.groupIds.includes(WHISPER_GROUP_ID) ?? false)
const menuOptions = computed<ContextMenuOption[]>(() => isWhisper.value
  ? [{ value: 'unwhisper', label: t('home.following_remove_whisper'), icon: 'i-mingcute:eye-line', danger: true }]
  : [
      { value: 'move', label: t('home.following_move_group'), icon: 'i-mingcute:folder-line' },
      ...(target.value?.groupIds.includes(-10)
        ? [{ value: 'unspecial', label: t('home.following_remove_special'), icon: 'i-mingcute:star-line' }]
        : [{ value: 'special', label: t('home.following_add_special'), icon: 'i-mingcute:star-line' }]),
      { value: 'whisper', label: t('home.following_add_whisper'), icon: 'i-mingcute:eye-close-line' },
      { value: 'unfollow', label: t('video_card.operation.unfollow_user'), icon: 'i-solar:user-minus-bold-duotone', danger: true },
    ])

const groupOptions = computed<ContextMenuOption[]>(() => {
  const normalGroups = groups.value.filter(group => group.tagid >= 0)
  if (!normalGroups.some(group => group.tagid === 0))
    normalGroups.push({ tagid: 0, name: '', count: 0, tip: '' })
  return normalGroups.map(group => ({
    value: group.tagid,
    label: group.tagid === 0 ? t('home.following_default_group') : group.name,
    icon: 'i-mingcute:folder-line',
    checked: target.value?.groupIds.includes(group.tagid) ?? false,
  }))
})

function open(event: MouseEvent, uploader: Uploader) {
  if (busy.value || confirmVisible.value)
    return
  revision++
  // 保存右键目标，后续切换右侧视频不会改变操作对象。
  target.value = { ...uploader, groupIds: [...uploader.groupIds] }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  cursorPosition.value = event.clientX || event.clientY
    ? { x: event.clientX, y: event.clientY }
    : { x: rect.left, y: rect.bottom }
  groupMenuVisible.value = false
  menuVisible.value = true
}

async function selectAction(action: string | number) {
  if (!target.value || busy.value)
    return
  if (action === 'unfollow' || action === 'unwhisper') {
    confirmedAction.value = action
    // 只有确认框的 confirm 事件能够发起取消关注请求。
    confirmVisible.value = true
  }
  else if (action === 'unspecial' || action === 'special' || action === 'whisper') {
    await updateRelation(action)
  }
  else if (action === 'move') {
    const requestRevision = revision
    busy.value = true
    try {
      const response: FollowingGroupsResult = await api.user.getFollowingGroups()
      if (disposed || requestRevision !== revision)
        return
      if (response.code !== 0 || !Array.isArray(response.data))
        throw new Error(response.message || t('common.load_failed'))
      groups.value = response.data
      emit('groupsLoaded', response.data)
      groupMenuVisible.value = true
    }
    catch (error) {
      if (!disposed)
        toast.error(t('home.following_action_failed', { message: error instanceof Error ? error.message : t('common.load_failed') }))
    }
    finally {
      busy.value = false
    }
  }
}

async function updateRelation(action: 'unfollow' | 'unspecial' | 'special' | 'move' | 'whisper' | 'unwhisper', groupId?: number) {
  const uploader = target.value
  if (!uploader || busy.value || disposed)
    return
  // 悄悄关注属于独立关系，不能把界面使用的分组 ID 发给标签接口。
  if (isWhisper.value ? action !== 'unwhisper' : action === 'unwhisper')
    return
  const normalIds = uploader.groupIds.filter(id => id >= 0)
  if (normalIds.length === 0)
    normalIds.push(0)
  if (action === 'move' && (groupId === undefined || !groupOptions.value.some(option => option.value === groupId)))
    return
  if (action === 'move' && normalIds.length === 1 && normalIds[0] === groupId)
    return
  busy.value = true
  try {
    const csrf = getCSRF()
    if (!csrf)
      throw new Error(t('common.please_log_in_first'))
    // 直接提交关系变更；失败时保留原关注，不能先取消再尝试加入悄悄关注。
    const relationAct = action === 'whisper' ? 3 : action === 'unwhisper' ? 4 : 2
    const response = ['unfollow', 'whisper', 'unwhisper'].includes(action)
      ? await api.user.relationModify({ fid: String(uploader.mid), act: relationAct, re_src: 11, csrf })
      : action === 'special'
        ? await api.user.copyFollowingUsers({ fids: String(uploader.mid), tagids: '-10', csrf })
        : await api.user.moveFollowingUsers({
            fids: String(uploader.mid),
            // 特别关注与普通分组独立：只移除本次操作涉及的原分组。
            beforeTagids: action === 'unspecial' ? '-10' : normalIds.join(','),
            afterTagids: action === 'unspecial' ? normalIds.join(',') : String(groupId),
            csrf,
          })
    if (response.code !== 0)
      throw new Error(response.message || String(response.code))
    if (disposed)
      return
    if (action === 'unfollow' || action === 'unwhisper') {
      emit('unfollowed', uploader.mid)
    }
    else {
      const groupIds = action === 'whisper'
        ? [WHISPER_GROUP_ID]
        : action === 'unspecial'
          ? normalIds
          : action === 'special'
            ? [-10, ...normalIds]
            : [...(uploader.groupIds.includes(-10) ? [-10] : []), groupId!]
      emit('groupsChanged', uploader.mid, groupIds)
    }
    toast.success(t('home.following_action_success', { name: uploader.name }))
  }
  catch (error) {
    if (!disposed)
      toast.error(t('home.following_action_failed', { message: error instanceof Error ? error.message : t('common.load_failed') }))
  }
  finally {
    busy.value = false
  }
}

onBeforeUnmount(() => {
  disposed = true
  revision++
})

defineExpose({ open })
</script>

<template>
  <ContextMenu
    v-if="menuVisible"
    :options="menuOptions"
    :menu-styles="{}"
    :cursor-position="cursorPosition"
    @select="selectAction"
    @close="menuVisible = false"
  />
  <ContextMenu
    v-if="groupMenuVisible"
    :options="groupOptions"
    :menu-styles="{}"
    :cursor-position="cursorPosition"
    @select="value => updateRelation('move', Number(value))"
    @close="groupMenuVisible = false"
  />
  <Dialog
    v-if="confirmVisible && target"
    :title="confirmedAction === 'unwhisper' ? $t('home.following_remove_whisper') : $t('video_card.unfollow_user_confirm.title')"
    width="420px"
    append-to-bewly-body
    @confirm="updateRelation(confirmedAction)"
    @close="confirmVisible = false"
  >
    <div class="unfollow-confirm-content">
      <p>{{ $t(confirmedAction === 'unwhisper' ? 'home.following_remove_whisper_confirm' : 'video_card.unfollow_user_confirm.message', { name: target.name }) }}</p>
      <p v-if="confirmedAction === 'unfollow'" class="unfollow-confirm-warning">
        {{ $t('video_card.unfollow_user_confirm.warning') }}
      </p>
    </div>
  </Dialog>
</template>

<style scoped lang="scss">
.unfollow-confirm-content {
  display: flex;
  flex-direction: column;
  gap: var(--bew-space-4);
  font-size: var(--bew-font-size-body);
  line-height: var(--bew-line-height-body);
}

.unfollow-confirm-warning {
  color: var(--bew-text-3);
  font-size: var(--bew-font-size-control);
  line-height: var(--bew-line-height-control);
}
</style>
