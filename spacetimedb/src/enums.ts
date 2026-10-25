// Shared enums for the SpacetimeDB module, desktop app, and AI worker.
// Plain TypeScript only (no spacetimedb imports) so any package can import it.
// Over the wire, each enum value is a tagged object: { tag: 'Focused' }.
// Mirrored in docs/architecture/contracts.md — keep both in sync.

export const SessionState = ['Lobby', 'Active', 'Break', 'Ended'] as const;
export type SessionState = (typeof SessionState)[number];

export const PomodoroPhase = ['Work', 'Break'] as const;
export type PomodoroPhase = (typeof PomodoroPhase)[number];

export const DeviceStatus = ['Connected', 'Disconnected'] as const;
export type DeviceStatus = (typeof DeviceStatus)[number];

export const AppCategory = [
  'OnTask',
  'OffTask',
] as const;
export type AppCategory = (typeof AppCategory)[number];

export const PhoneState = ['Unknown', 'Locked_In_Page_Visible', 'Phone_In_Use'] as const;
export type PhoneState = (typeof PhoneState)[number];

export const StatusLabel = ['Focused', 'OffTask', 'Away', 'Break', 'Unknown'] as const;
export type StatusLabel = (typeof StatusLabel)[number];

export const ReasonCode = [
  'Eyes_Closed',
  'Looking_Away',
  'Phone',
  'Distracting_App',
  'Idle',
  'Left_Seat',
  'Slouching',
  'Unknown',
] as const;
export type ReasonCode = (typeof ReasonCode)[number];

export const ModelName = ['Haiku', 'Inferentia', 'Fallback'] as const;
export type ModelName = (typeof ModelName)[number];

export const FocusBlockKind = ['DeepWork', 'Interruption', 'Break'] as const;
export type FocusBlockKind = (typeof FocusBlockKind)[number];

export const ScoreEventKind = ['Tick', 'StreakBonus', 'Penalty', 'QuickRecovery', 'GoalChecked'] as const;
export type ScoreEventKind = (typeof ScoreEventKind)[number];

export const CallState = ['Ringing', 'Active', 'Ended', 'Missed'] as const;
export type CallState = (typeof CallState)[number];

export const CallEndedReason = ['Timeout', 'ManualEnd', 'AllLeft', 'Declined'] as const;
export type CallEndedReason = (typeof CallEndedReason)[number];

export const CallResponse = ['Pending', 'Joined', 'Declined', 'Missed'] as const;
export type CallResponse = (typeof CallResponse)[number];

export const AlertKind = [
  'NudgeSelf',
  'GroupAlert',
  'PomodoroPhaseChange',
  'GoalCheckin',
  'CallIncoming',
  'TakeoverRequest',
] as const;
export type AlertKind = (typeof AlertKind)[number];

export const TakeoverState = ['Requested', 'Approved', 'Denied', 'Executed', 'Expired'] as const;
export type TakeoverState = (typeof TakeoverState)[number];

export const TakeoverAction = ['CloseTab', 'ShowOverlay', 'MuteApp'] as const;
export type TakeoverAction = (typeof TakeoverAction)[number];

export const PhoneSensorState = ['Unpaired', 'Paired', 'Visible', 'Hidden'] as const;
export type PhoneSensorState = (typeof PhoneSensorState)[number];

export const PhonePlatform = ['iOS', 'Android', 'Other'] as const;
export type PhonePlatform = (typeof PhonePlatform)[number];

export const AwardKind = ['MVP', 'Derailer', 'BestRecovery', 'LongestStreak'] as const;
export type AwardKind = (typeof AwardKind)[number];

export const StuckState = ['Open', 'Resolved'] as const;
export type StuckState = (typeof StuckState)[number];

export const StuckRole = ['User', 'Assistant'] as const;
export type StuckRole = (typeof StuckRole)[number];

export const MatchType = ['App', 'Domain', 'TitleRegex'] as const;
export type MatchType = (typeof MatchType)[number];
