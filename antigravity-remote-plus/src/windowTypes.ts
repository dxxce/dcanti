// Types for Multi-Window Antigravity IDE coordination & RPC protocol.

import { Trajectory } from "./lsClient";
import { ChatState, ModelInfo } from "./chatController";
import { TerminalInfo } from "./terminalController";
import { FileEntry } from "./fileController";
import { GitStatusFile } from "./gitController";

export interface IdeWindowInfo {
  id: string;
  title: string;
  workspaceName: string;
  workspacePath: string | null;
  workspaceFolders: Array<{ name: string; path: string }>;
  isGenerating: boolean;
  statusText: string;
  activeCascadeId?: string;
  pid?: number;
  isHost: boolean;
  lastActive: number;
}

export interface WindowRpcRequest {
  id: string;
  action: string;
  payload?: any;
}

export interface WindowRpcResponse {
  id: string;
  ok: boolean;
  data?: any;
  error?: string;
}

export interface WindowRegisterMessage {
  type: "register";
  window: IdeWindowInfo;
}

export interface WindowHeartbeatMessage {
  type: "heartbeat";
  windowId: string;
  isGenerating?: boolean;
  statusText?: string;
  activeCascadeId?: string;
}

export interface WindowEventMessage {
  type: "event";
  windowId: string;
  event: any;
}

export interface WindowRpcCallMessage {
  type: "rpc_call";
  request: WindowRpcRequest;
}

export interface WindowRpcResultMessage {
  type: "rpc_result";
  response: WindowRpcResponse;
}

export type SecondaryToHostMessage =
  | WindowRegisterMessage
  | WindowHeartbeatMessage
  | WindowEventMessage
  | WindowRpcResultMessage;

export type HostToSecondaryMessage =
  | WindowRpcCallMessage
  | { type: "registered"; ok: boolean }
  | { type: "ping" };
