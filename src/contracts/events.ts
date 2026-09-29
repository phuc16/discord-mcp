export const EVENT_TYPES = [
  'message_create', 'message_update', 'message_delete', 'member_join', 'member_remove', 'member_ban',
  'member_unban', 'role_create', 'role_update', 'role_delete', 'channel_create', 'channel_update',
  'channel_delete', 'voice_state', 'scheduled_event', 'gap',
] as const
export type EventType = (typeof EVENT_TYPES)[number]

export interface NormalizedEvent {
  id: number
  guildId: string
  type: EventType
  at: string
  data: Record<string, unknown>
}
export type NewEvent = Omit<NormalizedEvent, 'id'>
