export type ProviderId = "codex" | "claude-code" | string;

export type SourceKind =
  | "process"
  | "session-file"
  | "log"
  | "tmux"
  | "jsonl"
  | "app-server"
  | "mock";

export type SourceConfidence = "high" | "medium" | "low";

export type DataQuality = "complete" | "partial" | "process-only" | "stale";

export type SessionStatus = "running" | "idle" | "complete" | "failed" | "unknown";

export interface SourceRef {
  kind: SourceKind;
  label: string;
  confidence: SourceConfidence;
  path?: string;
  updatedAt?: string;
}

export interface BaseTimelineItem {
  id: string;
  type: "message" | "command" | "tool_call" | "file_change" | "status";
  createdAt: string;
  sourceRefs: SourceRef[];
}

export interface Message extends BaseTimelineItem {
  type: "message";
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface CommandRun extends BaseTimelineItem {
  type: "command";
  command: string;
  cwd?: string;
  exitCode?: number | null;
  output?: string;
}

export interface ToolCall extends BaseTimelineItem {
  type: "tool_call";
  name: string;
  input?: unknown;
  output?: unknown;
  status: SessionStatus;
}

export interface FileChange extends BaseTimelineItem {
  type: "file_change";
  path: string;
  summary: string;
  diff?: string;
}

export interface Status extends BaseTimelineItem {
  type: "status";
  status: SessionStatus;
  detail: string;
}

export type TimelineItem = Message | CommandRun | ToolCall | FileChange | Status;

export interface Turn {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  createdAt: string;
  sourceRefs: SourceRef[];
  messages: Message[];
  items: TimelineItem[];
}

export interface Session {
  id: string;
  providerId: ProviderId;
  providerName: string;
  title: string;
  projectPath?: string;
  status: SessionStatus;
  quality: DataQuality;
  startedAt?: string;
  lastUpdatedAt: string;
  recentMessage?: string;
  sources: SourceRef[];
  turns?: Turn[];
  timeline: TimelineItem[];
  rawAvailable?: boolean;
}

export interface RawSession {
  text: string;
  source: SourceKind | string;
  confidence?: SourceConfidence;
}

export interface ProviderAdapter {
  id: ProviderId;
  displayName: string;
  listSessions(): Promise<Session[]>;
  getSession?(id: string): Promise<Session | null>;
  getRawSession?(id: string): Promise<RawSession | null>;
}
