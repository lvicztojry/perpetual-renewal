"use client";

import {
  BarChart3,
  Bell,
  BookHeart,
  Check,
  Edit3,
  Heart,
  MessageCircle,
  Mic,
  Plus,
  RotateCcw,
  Send,
  Settings,
  Sparkles,
  Star,
  Trash2,
  Upload,
  Volume2
} from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  applyRelationshipKindDefaults,
  createRelationshipObjectDraft,
  RelationshipObjectForm,
  type RelationshipObjectFormState
} from "./relationship-object-form";
import {
  relationshipKindLabels,
  type CompanionProfile,
  type MemoryRecord,
  type MessageRecord
} from "@/lib/renewal/types";
import { inferCustomFrequencyValue } from "@/lib/relationship/proactive-frequency";
import {
  createContactFileImportPlan,
  createMediaFileImportPlan,
  createStructuredTextImportPlan,
  structuredImportLimits,
  type StructuredImportKind,
  type StructuredImportPlan
} from "@/lib/import/structured-client-import";

type InspectorMode =
  | "profile"
  | "create"
  | "edit"
  | "memories"
  | "proactive"
  | "import"
  | "usage";

type ImportSourceKind = "material" | "tone_sample" | "memory_candidate";
type ImportMode = "single" | "batch" | "jsonl";

type ImportSummary = {
  mode: ImportMode;
  sourceKind: ImportSourceKind;
  createdCount: number;
  redactionCount: number;
  skippedCount: number;
  duplicateCount?: number;
  existingDuplicateCount?: number;
  inputCount?: number;
  acceptedCount?: number;
  truncatedCount?: number;
  parseSkippedCount?: number;
  limit?: {
    maxItems: number;
    maxItemChars: number;
    maxCandidates: number;
  };
  lifecycle: string[];
};

type DraftSafety = {
  ok?: boolean;
  type?: string;
  action?: string;
  stage?: string;
  severity?: string;
  reason?: string;
};

type ProactiveDraft = {
  id: string;
  companionId?: string;
  kind: string;
  content: string;
  reason: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  scheduledAt?: string;
  nextCandidateAt?: string | null;
  frequency?: {
    preset?: string;
    everyMinutes?: number;
    label?: string;
  } | null;
  safety?: DraftSafety;
  preflightSafety?: DraftSafety;
  postflightSafety?: DraftSafety;
};

type ProactiveDraftStatus = "draft" | "sent" | "dismissed" | "blocked";
type ProactiveDraftFilter = "all" | ProactiveDraftStatus;

type VoicePreview = {
  audioDataUrl?: string;
  provider: string;
  model: string;
  voice?: string;
  requestedProvider?: string;
  credentialSource?: "server-env" | "user-vault";
  fallback?: boolean;
  fallbackKind?: string;
  fallbackReason?: string;
};

type UsageDashboard = {
  persistence: "prisma" | "memory";
  rangeDays: number;
  summary: {
    calls: number;
    successfulCalls: number;
    failedCalls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    averageLatencyMs: number | null;
  };
  byProviderModel: Array<{
    provider: string;
    model: string;
    calls: number;
    totalTokens: number;
    estimatedCostUsd: number;
  }>;
  recent: Array<{
    id: string;
    purpose: string;
    provider: string;
    model: string;
    status: string;
    totalTokens: number | null;
    estimatedCostUsd: number;
    latencyMs: number | null;
    errorKind: string | null;
    createdAt: string;
  }>;
};

const memoryTypeLabels: Record<MemoryRecord["type"], string> = {
  user_fact: "用户事实",
  relationship_event: "关系事件",
  companion_profile: "角色设定",
  emotional_preference: "情绪偏好"
};

const importSourceLabels: Record<ImportSourceKind, string> = {
  material: "素材",
  tone_sample: "语气样例",
  memory_candidate: "记忆候选"
};

const importModeLabels: Record<ImportMode, string> = {
  single: "单段",
  batch: "多段",
  jsonl: "JSONL"
};

const proactiveDraftFilterOptions: Array<{
  value: ProactiveDraftFilter;
  label: string;
}> = [
  { value: "draft", label: "草稿" },
  { value: "sent", label: "已发送" },
  { value: "dismissed", label: "已忽略" },
  { value: "blocked", label: "已拦截" },
  { value: "all", label: "全部" }
];

const maxVoiceUploadBytes = 4 * 1024 * 1024;
const maxImportFileBytes = 512 * 1024;
const allowedImportFileExtensions = [".txt", ".jsonl", ".json"] as const;
const structuredImportKindLabels: Record<StructuredImportKind, string> = {
  media: "媒体素材",
  contact: "通讯录"
};

export function RenewalWorkspace() {
  const [companions, setCompanions] = useState<CompanionProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [draft, setDraft] = useState("");
  const [form, setForm] = useState<RelationshipObjectFormState | null>(null);
  const [createForm, setCreateForm] = useState<RelationshipObjectFormState>(
    createRelationshipObjectDraft()
  );
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>("profile");
  const [proactiveDrafts, setProactiveDrafts] = useState<ProactiveDraft[]>([]);
  const [proactiveDraftFilter, setProactiveDraftFilter] =
    useState<ProactiveDraftFilter>("draft");
  const [usageDashboard, setUsageDashboard] = useState<UsageDashboard | null>(null);
  const [importText, setImportText] = useState("");
  const [importMode, setImportMode] = useState<ImportMode>("single");
  const [importSourceKind, setImportSourceKind] = useState<ImportSourceKind>("memory_candidate");
  const [structuredImportKind, setStructuredImportKind] =
    useState<StructuredImportKind>("media");
  const [structuredImportText, setStructuredImportText] = useState("");
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [isBooting, setIsBooting] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingDrafts, setIsLoadingDrafts] = useState(false);
  const [isLoadingUsage, setIsLoadingUsage] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [busyMessageId, setBusyMessageId] = useState<string | null>(null);
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [editingMemoryContent, setEditingMemoryContent] = useState("");
  const [editingMemoryType, setEditingMemoryType] = useState<MemoryRecord["type"]>("user_fact");
  const [status, setStatus] = useState("正在连接关系工作台...");
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [proactiveError, setProactiveError] = useState<string | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [proactivePersistence, setProactivePersistence] = useState<string | null>(null);
  const [proactiveSafety, setProactiveSafety] = useState<DraftSafety | null>(null);
  const [voicePreview, setVoicePreview] = useState<VoicePreview | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);

  const activeCompanion = useMemo(
    () => companions.find((companion) => companion.id === activeId) ?? companions[0],
    [activeId, companions]
  );
  const latestAssistantMessage = useMemo(
    () => [...messages].reverse().find((message) => message.role === "assistant"),
    [messages]
  );
  const proactiveDraftStats = useMemo(
    () =>
      proactiveDrafts.reduce<Record<ProactiveDraftFilter, number>>(
        (stats, draft) => {
          stats.all += 1;
          stats[normalizeDraftStatus(draft.status)] += 1;
          return stats;
        },
        {
          all: 0,
          draft: 0,
          sent: 0,
          dismissed: 0,
          blocked: 0
        }
      ),
    [proactiveDrafts]
  );
  const visibleProactiveDrafts = useMemo(
    () =>
      proactiveDraftFilter === "all"
        ? proactiveDrafts
        : proactiveDrafts.filter(
            (draft) => normalizeDraftStatus(draft.status) === proactiveDraftFilter
          ),
    [proactiveDraftFilter, proactiveDrafts]
  );

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadCompanions() {
      try {
        const response = await fetch("/api/companions", { cache: "no-store" });
        if (!response.ok) throw new Error("关系对象加载失败。");
        const payload = (await response.json()) as { companions: CompanionProfile[] };
        if (!mounted) return;
        setCompanions(payload.companions);
        const first = payload.companions[0];
        setActiveId(first?.id ?? null);
        setForm(first ? toForm(first) : null);
        setStatus(first ? "已连接到内存服务层" : "还没有关系对象");
      } catch (loadError) {
        if (!mounted) return;
        setError(toSafeWorkspaceError(loadError, "关系对象加载失败。"));
      } finally {
        if (mounted) setIsBooting(false);
      }
    }

    loadCompanions();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    if (!activeCompanion) return;

    async function loadMessages() {
      try {
        const response = await fetch(`/api/conversations/${activeCompanion.conversationId}/messages`, {
          cache: "no-store"
        });
        if (!response.ok) throw new Error("消息加载失败。");
        const payload = (await response.json()) as { messages: MessageRecord[] };
        if (mounted) setMessages(payload.messages);
      } catch (loadError) {
        if (mounted) {
          setError(toSafeWorkspaceError(loadError, "消息加载失败。"));
        }
      }
    }

    loadMessages();
    return () => {
      mounted = false;
    };
  }, [activeCompanion]);

  function selectCompanion(companion: CompanionProfile) {
    setActiveId(companion.id);
    setForm(toForm(companion));
    setInspectorMode("profile");
    setError(null);
    setFormError(null);
    setImportError(null);
    setImportSummary(null);
    setProactiveError(null);
    setProactiveDraftFilter("draft");
    setUsageError(null);
  }

  async function saveCompanion() {
    if (!form?.id) return;
    setError(null);
    setFormError(null);
    setIsSaving(true);
    setStatus("正在保存关系设定...");

    try {
      const response = await fetch(`/api/companions/${form.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toCompanionPayload(form))
      });
      if (!response.ok) {
        throw new Error(await readResponseError(response, "关系设定保存失败。"));
      }
      const payload = (await response.json()) as { companion: CompanionProfile };
      setCompanions((current) =>
        current.map((companion) =>
          companion.id === payload.companion.id ? payload.companion : companion
        )
      );
      setForm(toForm(payload.companion));
      setInspectorMode("profile");
      setStatus("关系设定已通过 API 保存");
    } catch (saveError) {
      const message = toSafeWorkspaceError(saveError, "关系设定保存失败。");
      setFormError(message);
      setStatus("关系设定保存失败，请检查后重试");
    } finally {
      setIsSaving(false);
    }
  }

  function startCreateCompanion() {
    setCreateForm(createRelationshipObjectDraft("CUSTOM"));
    setError(null);
    setFormError(null);
    setInspectorMode("create");
    setStatus("正在创建一段新的关系回响");
  }

  function startEditCompanion() {
    if (!activeCompanion) return;
    setForm(toForm(activeCompanion));
    setError(null);
    setFormError(null);
    setInspectorMode("edit");
    setStatus("正在编辑当前关系设定");
  }

  async function createCompanion() {
    setError(null);
    setFormError(null);
    setIsSaving(true);
    setStatus("正在创建关系对象...");

    try {
      const response = await fetch("/api/companions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toCompanionPayload(createForm))
      });
      if (!response.ok) {
        throw new Error(await readResponseError(response, "新建关系失败。"));
      }
      const payload = (await response.json()) as { companion: CompanionProfile };
      setCompanions((current) => [payload.companion, ...current]);
      setActiveId(payload.companion.id);
      setForm(toForm(payload.companion));
      setCreateForm(createRelationshipObjectDraft("CUSTOM"));
      setInspectorMode("profile");
      setMessages([]);
      setDraft("");
      setStatus("新关系对象已创建，可以开始聊天");
    } catch (createError) {
      const message = toSafeWorkspaceError(createError, "新建关系失败。");
      setFormError(message);
      setStatus("新建关系失败，请检查后重试");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteActiveCompanion() {
    if (!activeCompanion || isSaving) return;

    const confirmed = window.confirm(
      `删除「${activeCompanion.name}」会同时移除相关对话、记忆、关系状态和主动回响草稿。确定继续吗？`
    );
    if (!confirmed) return;

    setIsSaving(true);
    setError(null);
    setStatus("正在删除关系对象...");

    try {
      const response = await fetch(`/api/companions/${activeCompanion.id}`, {
        method: "DELETE"
      });
      const payload = (await response.json()) as { deleted?: boolean; error?: string };

      if (!response.ok || !payload.deleted) {
        throw new Error(payload.error ?? "删除关系对象失败。");
      }

      setCompanions((current) => {
        const nextCompanions = current.filter((companion) => companion.id !== activeCompanion.id);
        const nextActive = nextCompanions[0] ?? null;
        setActiveId(nextActive?.id ?? null);
        setForm(nextActive ? toForm(nextActive) : null);
        return nextCompanions;
      });
      setMessages([]);
      setDraft("");
      setProactiveDrafts([]);
      setVoicePreview(null);
      setInspectorMode("profile");
      setStatus("关系对象已删除");
    } catch (deleteError) {
      setError(toSafeWorkspaceError(deleteError, "删除关系对象失败。"));
      setStatus("删除关系对象失败，请稍后重试");
    } finally {
      setIsSaving(false);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !activeCompanion || isSending) return;

    setIsSending(true);
    setError(null);

    try {
      const response = await fetch(`/api/conversations/${activeCompanion.conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content })
      });
      if (!response.ok) throw new Error("消息发送失败。");
      const payload = (await response.json()) as {
        userMessage: MessageRecord;
        assistantMessage: MessageRecord | null;
        pendingMemory: MemoryRecord | null;
        relationshipState: CompanionProfile["relationshipState"];
        completion: { provider: string; model: string } | null;
        assistantError?: { message: string; provider?: string; model?: string; status?: number };
      };

      setMessages((current) => [
        ...current,
        payload.userMessage,
        ...(payload.assistantMessage ? [payload.assistantMessage] : [])
      ]);
      setCompanions((current) =>
        current.map((companion) =>
          companion.id === activeCompanion.id
            ? {
                ...companion,
                relationshipState: payload.relationshipState,
                memories: payload.pendingMemory
                  ? [payload.pendingMemory, ...companion.memories]
                  : companion.memories
              }
            : companion
        )
      );
      setDraft("");
      setStatus(
        payload.completion
          ? `已回复 · ${payload.completion.provider}/${payload.completion.model}`
          : `用户消息已保存，回复可重试 · ${formatProviderLabel(payload.assistantError)}`
      );
      if (payload.assistantError) {
        setError(`回复生成失败：${redactWorkspaceError(payload.assistantError.message)}`);
      }
    } catch (sendError) {
      setError(toSafeWorkspaceError(sendError, "消息发送失败。"));
    } finally {
      setIsSending(false);
    }
  }

  async function regenerateMessage(messageId?: string) {
    if (!activeCompanion || !messageId || busyMessageId) return;

    setBusyMessageId(messageId);
    setError(null);

    try {
      const response = await fetch(`/api/conversations/${activeCompanion.conversationId}/messages`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "regenerate", messageId })
      });
      const payload = (await response.json()) as {
        assistantMessage?: MessageRecord;
        completion?: { provider: string; model: string };
        error?: string;
      };

      if (!response.ok || !payload.assistantMessage) {
        throw new Error(payload.error ?? "重新生成失败。");
      }

      setMessages((current) =>
        current.map((message) =>
          message.id === payload.assistantMessage?.id ? payload.assistantMessage : message
        )
      );
      setStatus(
        payload.completion
          ? `已重新生成 · ${payload.completion.provider}/${payload.completion.model}`
          : "已重新生成"
      );
    } catch (regenerateError) {
      setError(toSafeWorkspaceError(regenerateError, "重新生成失败。"));
    } finally {
      setBusyMessageId(null);
    }
  }

  async function deleteMessage(messageId: string) {
    if (!activeCompanion || busyMessageId) return;

    setBusyMessageId(messageId);
    setError(null);

    try {
      const response = await fetch(
        `/api/conversations/${activeCompanion.conversationId}/messages?messageId=${encodeURIComponent(
          messageId
        )}`,
        { method: "DELETE" }
      );
      const payload = (await response.json()) as { deleted?: boolean; error?: string };

      if (!response.ok || !payload.deleted) {
        throw new Error(payload.error ?? "删除消息失败。");
      }

      setMessages((current) => current.filter((message) => message.id !== messageId));
      setStatus("消息已删除");
    } catch (deleteError) {
      setError(toSafeWorkspaceError(deleteError, "删除消息失败。"));
    } finally {
      setBusyMessageId(null);
    }
  }

  async function toggleMessageImportant(message: MessageRecord) {
    if (!activeCompanion || busyMessageId) return;

    setBusyMessageId(message.id);
    setError(null);

    try {
      const response = await fetch(`/api/conversations/${activeCompanion.conversationId}/messages`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_important",
          messageId: message.id,
          important: !isMessageImportant(message)
        })
      });
      const payload = (await response.json()) as { message?: MessageRecord; error?: string };

      if (!response.ok || !payload.message) {
        throw new Error(payload.error ?? "重要消息更新失败。");
      }

      setMessages((current) =>
        current.map((item) => (item.id === payload.message?.id ? payload.message : item))
      );
      setStatus(isMessageImportant(payload.message) ? "已标记为重要消息" : "已取消重要标记");
    } catch (importantError) {
      setError(toSafeWorkspaceError(importantError, "重要消息更新失败。"));
    } finally {
      setBusyMessageId(null);
    }
  }

  async function updateProactiveDraftStatus(
    draftId: string,
    status: NonNullable<ProactiveDraft["status"]>
  ) {
    if (busyMessageId) return;

    setBusyMessageId(draftId);
    setError(null);
    setProactiveError(null);

    try {
      const response = await fetch(`/api/proactive-messages/${draftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      const payload = (await response.json()) as {
        proactiveMessage?: ProactiveDraft;
        error?: string;
      };

      if (!response.ok || !payload.proactiveMessage) {
        throw new Error(payload.error ?? "主动回响状态更新失败。");
      }

      setProactiveDrafts((current) =>
        current.map((draft) =>
          draft.id === payload.proactiveMessage?.id
            ? { ...draft, ...payload.proactiveMessage }
            : draft
        )
      );
      setStatus(`主动回响已标记为${formatDraftStatus(status, null)}`);
    } catch (draftError) {
      const message = toSafeWorkspaceError(draftError, "主动回响状态更新失败。");
      setProactiveError(message);
      setStatus("主动回响状态更新失败，请稍后重试");
    } finally {
      setBusyMessageId(null);
    }
  }

  async function updateMemory(memoryId: string, status: MemoryRecord["status"]) {
    setBusyMessageId(memoryId);
    setError(null);

    try {
      const response = await fetch(`/api/memories/${memoryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      const payload = (await response.json()) as { memory?: MemoryRecord; error?: string };

      if (!response.ok || !payload.memory) {
        throw new Error(payload.error ?? "记忆更新失败。");
      }

      mergeMemory(payload.memory);
      setStatus("记忆状态已更新");
    } catch (memoryError) {
      setError(toSafeWorkspaceError(memoryError, "记忆更新失败。"));
    } finally {
      setBusyMessageId(null);
    }
  }

  async function saveMemoryContent(memoryId: string) {
    const content = editingMemoryContent.trim();
    if (!content) {
      setError("记忆内容不能为空。");
      return;
    }

    setBusyMessageId(memoryId);
    setError(null);

    try {
      const response = await fetch(`/api/memories/${memoryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, type: editingMemoryType })
      });
      const payload = (await response.json()) as { memory?: MemoryRecord; error?: string };

      if (!response.ok || !payload.memory) {
        throw new Error(payload.error ?? "记忆保存失败。");
      }

      mergeMemory(payload.memory);
      setEditingMemoryId(null);
      setEditingMemoryContent("");
      setEditingMemoryType("user_fact");
      setStatus("记忆内容已更新");
    } catch (memoryError) {
      setError(toSafeWorkspaceError(memoryError, "记忆保存失败。"));
    } finally {
      setBusyMessageId(null);
    }
  }

  function startEditMemory(memory: MemoryRecord) {
    setEditingMemoryId(memory.id);
    setEditingMemoryContent(memory.content);
    setEditingMemoryType(memory.type);
    setError(null);
  }

  async function deleteMemory(memoryId: string) {
    setBusyMessageId(memoryId);
    setError(null);

    try {
      const response = await fetch(`/api/memories/${memoryId}`, { method: "DELETE" });
      const payload = (await response.json()) as { memory?: MemoryRecord; error?: string };

      if (!response.ok || !payload.memory) {
        throw new Error(payload.error ?? "记忆删除失败。");
      }

      setCompanions((current) =>
        current.map((companion) =>
          companion.id === payload.memory?.companionId
            ? {
                ...companion,
                memories: companion.memories.filter((memory) => memory.id !== memoryId)
              }
            : companion
        )
      );
      setStatus("记忆已删除");
    } catch (memoryError) {
      setError(toSafeWorkspaceError(memoryError, "记忆删除失败。"));
    } finally {
      setBusyMessageId(null);
    }
  }

  async function generateProactiveDrafts() {
    if (!activeCompanion) return;

    setIsLoadingDrafts(true);
    setError(null);
    setProactiveError(null);
    setProactiveSafety(null);
    setInspectorMode("proactive");
    setStatus("正在生成主动回响草稿...");

    try {
      const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
      const response = await fetch(`/api/companions/${activeCompanion.id}/proactive-drafts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lastUserMessage: lastUserMessage?.content,
          proactiveMessagesEnabled: true,
          force: true
        })
      });
      const payload = (await response.json()) as {
        data?: ProactiveDraft[];
        error?: string;
        persistence?: string;
        safety?: DraftSafety;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "主动回响生成失败。");
      }

      setProactiveDrafts(payload.data ?? []);
      setProactiveDraftFilter("draft");
      setProactivePersistence(payload.persistence ?? "persisted");
      setProactiveSafety(payload.safety ?? null);
      setStatus(payload.data?.length ? "主动回响草稿已生成" : "暂无可发送的主动回响草稿");
    } catch (draftError) {
      const message = toSafeWorkspaceError(draftError, "主动回响生成失败。");
      setProactiveError(message);
      setStatus("主动回响生成失败，请稍后重试");
    } finally {
      setIsLoadingDrafts(false);
    }
  }

  async function importTextMaterials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeCompanion || isImporting) return;

    const text = importText.trim();
    if (!text) {
      setImportError("请先粘贴要导入的内容。");
      return;
    }

    setIsImporting(true);
    setImportError(null);
    setImportSummary(null);
    setStatus("正在导入为候选记忆...");

    try {
      const response = await fetch(`/api/companions/${activeCompanion.id}/imports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildImportRequest(importMode, text, importSourceKind))
      });
      const payload = (await response.json()) as {
        memories?: MemoryRecord[];
        importSummary?: ImportSummary;
        error?: string;
      };

      if (!response.ok || !payload.memories?.length) {
        setImportSummary(payload.importSummary ?? null);
        throw new Error(payload.error ?? "导入失败。");
      }

      mergeMemories(payload.memories);
      setImportSummary(payload.importSummary ?? null);
      setImportText("");
      setStatus(
        `已导入 ${payload.importSummary?.createdCount ?? payload.memories.length} 条候选记忆`
      );
    } catch (importFailure) {
      const message = toSafeWorkspaceError(importFailure, "导入失败。");
      setImportError(message);
      setStatus("导入失败，请检查内容后重试");
    } finally {
      setIsImporting(false);
    }
  }

  async function readImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    setImportError(null);
    setImportSummary(null);
    setImportFileName(null);

    const extension = readImportFileExtension(file.name);
    if (!extension) {
      setImportError("只支持 .txt、.jsonl、.json 文本文件。");
      setStatus("文件未导入：格式不支持");
      return;
    }

    if (file.size > maxImportFileBytes) {
      setImportError(`文件不能超过 ${formatBytes(maxImportFileBytes)}。`);
      setStatus("文件未导入：体积过大");
      return;
    }

    try {
      const rawText = await file.text();
      const normalized = normalizeImportFileText(rawText, extension);
      if (!normalized.text.trim()) {
        throw new Error("文件里没有可导入的文本。");
      }

      setImportMode(normalized.mode);
      setImportText(normalized.text);
      setImportFileName(file.name);
      setStatus(`已读取 ${file.name}，确认内容后可导入`);
    } catch (readError) {
      const message = readError instanceof Error ? readError.message : "文件读取失败。";
      setImportError(message);
      setStatus("文件读取失败，请换一个文本文件");
    }
  }

  async function readStructuredImportFile(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (!files.length) return;

    setImportError(null);
    setImportSummary(null);

    try {
      if (structuredImportKind === "media") {
        applyStructuredImportPlan(
          createMediaFileImportPlan(
            files.map((file) => ({
              name: file.name,
              type: file.type,
              size: file.size,
              lastModified: file.lastModified
            }))
          ),
          files.length === 1 ? files[0].name : `${files.length} 个媒体文件`
        );
        return;
      }

      const file = files[0];
      const text = await file.text();
      applyStructuredImportPlan(
        createContactFileImportPlan({
          fileName: file.name,
          fileText: text,
          fileSize: file.size
        }),
        file.name
      );
    } catch (readError) {
      const message = readError instanceof Error ? readError.message : "结构化素材读取失败。";
      setImportError(message);
      setStatus("结构化素材读取失败，请换一个文件");
    }
  }

  function applyStructuredTextImport() {
    applyStructuredImportPlan(
      createStructuredTextImportPlan({
        kind: structuredImportKind,
        text: structuredImportText
      }),
      structuredImportKindLabels[structuredImportKind]
    );
  }

  function applyStructuredImportPlan(plan: StructuredImportPlan, sourceName: string) {
    if (!plan.items.length) {
      setImportError(plan.warnings[0] ?? "没有发现可导入的结构化素材。");
      setStatus("结构化素材未导入：没有可用条目");
      return;
    }

    setImportMode("jsonl");
    setImportSourceKind(plan.items[0].sourceKind);
    setImportText(plan.items.map((item) => JSON.stringify(item)).join("\n"));
    setImportFileName(sourceName);
    setStructuredImportText("");
    setImportError(plan.warnings.length ? plan.warnings.join(" ") : null);
    setStatus(
      `已整理 ${plan.items.length} 条${structuredImportKindLabels[structuredImportKind]}，确认后可导入`
    );
  }

  async function toggleVoiceRecording() {
    if (isRecording) {
      stopVoiceRecording();
      return;
    }

    await startVoiceRecording();
  }

  async function startVoiceRecording() {
    if (!activeCompanion || isTranscribing) return;

    if (!canRecordVoice()) {
      await transcribeMockVoice("当前浏览器不支持录音，已使用 mock 语音链路。");
      return;
    }

    setError(null);
    setVoicePreview(null);
    setStatus("正在请求麦克风权限...");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = readSupportedAudioMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      audioChunksRef.current = [];
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      recorder.onerror = () => {
        cleanupVoiceRecording();
        setError("录音失败，请稍后重试。");
        setStatus("录音失败，请稍后重试");
      };
      recorder.onstop = () => {
        const chunks = audioChunksRef.current;
        const audioBlob = new Blob(chunks, {
          type: recorder.mimeType || mimeType || "audio/webm"
        });
        cleanupVoiceRecording();

        if (!audioBlob.size) {
          setError("没有录到可转写的语音。");
          setStatus("没有录到可转写的语音");
          return;
        }

        void transcribeAudioBlob(audioBlob);
      };

      recorder.start();
      setIsRecording(true);
      setStatus("正在录音，再点一次麦克风结束");
    } catch {
      cleanupVoiceRecording();
      await transcribeMockVoice("麦克风不可用，已使用 mock 语音链路。");
    }
  }

  function stopVoiceRecording() {
    const recorder = mediaRecorderRef.current;

    if (recorder && recorder.state === "recording") {
      setStatus("正在处理录音...");
      recorder.stop();
      return;
    }

    cleanupVoiceRecording();
  }

  async function transcribeMockVoice(fallbackStatus?: string) {
    if (!activeCompanion || isTranscribing) return;

    setIsTranscribing(true);
    setError(null);
    setVoicePreview(null);
    setStatus(fallbackStatus ?? "正在转写语音...");

    try {
      const response = await fetch("/api/voice/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: "zh-CN",
          mockTranscript: draft.trim() || `我想听见${activeCompanion.name}的声音。`
        })
      });
      const payload = (await response.json()) as {
        text?: string;
        provider?: string;
        model?: string;
        requestedProvider?: string;
        credentialSource?: "server-env" | "user-vault";
        fallback?: boolean;
        fallbackKind?: string;
        error?: string;
      };

      if (!response.ok || !payload.text) {
        throw new Error(payload.error ?? "语音转写失败。");
      }

      setDraft(payload.text);
      setStatus(`语音已转写 · ${formatVoiceProviderStatus(payload)}`);
    } catch (voiceError) {
      setError(toSafeWorkspaceError(voiceError, "语音转写失败。"));
      setStatus("语音转写失败，请稍后重试");
    } finally {
      setIsTranscribing(false);
    }
  }

  async function transcribeAudioBlob(audioBlob: Blob) {
    if (audioBlob.size > maxVoiceUploadBytes) {
      setError("录音太长，请控制在更短的一段话内。");
      setStatus("录音太长，未发送转写");
      return;
    }

    setIsTranscribing(true);
    setError(null);
    setVoicePreview(null);
    setStatus("正在转写录音...");

    try {
      const audioBase64 = await blobToBase64(audioBlob);
      const mimeType = audioBlob.type || "audio/webm";
      const response = await fetch("/api/voice/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioBase64,
          mimeType,
          fileName: `voice-input.${audioExtensionFromMimeType(mimeType)}`,
          language: "zh-CN"
        })
      });
      const payload = (await response.json()) as {
        text?: string;
        provider?: string;
        model?: string;
        requestedProvider?: string;
        credentialSource?: "server-env" | "user-vault";
        fallback?: boolean;
        fallbackKind?: string;
        fallbackReason?: string;
        error?: string;
      };

      if (!response.ok || !payload.text) {
        throw new Error(payload.error ?? "语音转写失败。");
      }

      setDraft(payload.text);
      setStatus(`语音已转写 · ${formatVoiceProviderStatus(payload)}`);
    } catch (voiceError) {
      setError(toSafeWorkspaceError(voiceError, "语音转写失败。"));
      setStatus("语音转写失败，请稍后重试");
    } finally {
      setIsTranscribing(false);
    }
  }

  function cleanupVoiceRecording() {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    setIsRecording(false);
  }

  async function synthesizeLatestReply() {
    if (!latestAssistantMessage || isSynthesizing) return;

    setIsSynthesizing(true);
    setError(null);
    setVoicePreview(null);
    setStatus("正在生成语音回复...");

    try {
      const response = await fetch("/api/voice/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: latestAssistantMessage.content,
          voice: "warm",
          format: "wav"
        })
      });
      const payload = (await response.json()) as VoicePreview & { error?: string };

      if (!response.ok || !payload.audioDataUrl) {
        throw new Error(payload.error ?? "语音回复生成失败。");
      }

      setVoicePreview(payload);
      setStatus(`语音回复已生成 · ${formatVoiceProviderStatus(payload)}`);
    } catch (voiceError) {
      setError(toSafeWorkspaceError(voiceError, "语音回复生成失败。"));
      setStatus("语音回复生成失败，请稍后重试");
    } finally {
      setIsSynthesizing(false);
    }
  }

  async function loadUsageDashboard() {
    setIsLoadingUsage(true);
    setError(null);
    setUsageError(null);
    setInspectorMode("usage");
    setStatus("正在读取模型调用看板...");

    try {
      const response = await fetch("/api/usage/model-calls?rangeDays=7", { cache: "no-store" });
      const payload = (await response.json()) as {
        dashboard?: UsageDashboard;
        error?: string;
      };

      if (!response.ok || !payload.dashboard) {
        throw new Error(payload.error ?? "模型调用看板加载失败。");
      }

      setUsageDashboard(payload.dashboard);
      setStatus("模型调用看板已更新");
    } catch (usageLoadError) {
      const message = toSafeWorkspaceError(usageLoadError, "模型调用看板加载失败。");
      setUsageError(message);
      setStatus("模型调用看板加载失败，请稍后重试");
    } finally {
      setIsLoadingUsage(false);
    }
  }

  function mergeMemories(memories: MemoryRecord[]) {
    for (const memory of memories) {
      mergeMemory(memory);
    }
  }

  function mergeMemory(memory: MemoryRecord) {
    setCompanions((current) =>
      current.map((companion) =>
        companion.id === memory.companionId
          ? {
              ...companion,
              memories: [memory, ...companion.memories.filter((item) => item.id !== memory.id)]
            }
          : companion
      )
    );
  }

  const activeMemories = activeCompanion?.memories ?? [];
  const activeCount = activeMemories.filter((memory) => memory.status === "active").length;
  const pendingCount = activeMemories.filter((memory) => memory.status === "pending").length;

  return (
    <main className="app-shell">
      <aside className="rail" aria-label="关系对象">
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={22} />
          </div>
          <div>
            <h1>生生不息</h1>
            <p>念念不忘，必有回响</p>
          </div>
        </div>

        <section className="rail-section">
          <p className="section-label">关系</p>
          <div className="relationship-list">
            {companions.map((companion) => (
              <button
                className={`relationship-button ${companion.id === activeId ? "active" : ""}`}
                key={companion.id}
                onClick={() => selectCompanion(companion)}
                title={`切换到 ${companion.name}`}
                type="button"
              >
                <div className="avatar">{companion.name.slice(0, 1)}</div>
                <div>
                  <div className="relationship-name">{companion.name}</div>
                  <div className="relationship-kind">
                    {relationshipKindLabels[companion.relationshipKind]}
                  </div>
                </div>
              </button>
            ))}
            {!companions.length && !isBooting ? <div className="empty">还没有关系</div> : null}
          </div>
        </section>

        <div className="quick-actions">
          <button className="text-button primary-action" onClick={startCreateCompanion} type="button">
            <Plus size={17} />
            创建关系对象
          </button>
          <a className="text-button" href="/settings" title="用户设置">
            <Settings size={17} />
            设置
          </a>
          <a className="text-button" href="/login" title="切换账号">
            <Sparkles size={17} />
            登录
          </a>
        </div>
      </aside>

      <section className="main" aria-label="聊天">
        <header className="topbar">
          {activeCompanion ? (
            <div className="companion-heading">
              <div className="avatar">{activeCompanion.name.slice(0, 1)}</div>
              <div>
                <div className="title-row">
                  <h2>{activeCompanion.name}</h2>
                  <span className="pill teal">
                    {relationshipKindLabels[activeCompanion.relationshipKind]}
                  </span>
                  {activeCompanion.immersionEnabled ? (
                    <span className="pill coral">沉浸</span>
                  ) : null}
                </div>
                <p className="muted">{activeCompanion.speakingStyle}</p>
              </div>
            </div>
          ) : (
            <div>
              <h2>关系工作台</h2>
              <p className="muted">{status}</p>
            </div>
          )}
          <div className="topbar-actions">
            <button
              aria-label="编辑关系设定"
              className="icon-button"
              disabled={!activeCompanion}
              onClick={startEditCompanion}
              title="打开编辑面板"
              type="button"
            >
              <Edit3 size={18} />
            </button>
            <button
              aria-label="重新生成最近一条回复"
              className="icon-button"
              disabled={!latestAssistantMessage || !!busyMessageId}
              onClick={() => regenerateMessage(latestAssistantMessage?.id)}
              title="重新生成最近一条回复"
              type="button"
            >
              <RotateCcw size={18} />
            </button>
            <button
              aria-label="记忆"
              className="icon-button"
              disabled={!activeCompanion}
              onClick={() => setInspectorMode("memories")}
              title="记忆"
              type="button"
            >
              <BookHeart size={18} />
            </button>
            <button
              aria-label="导入素材"
              className="icon-button"
              disabled={!activeCompanion || isImporting}
              onClick={() => setInspectorMode("import")}
              title="导入素材"
              type="button"
            >
              <Upload size={18} />
            </button>
            <button
              aria-label="主动回响"
              className="icon-button"
              disabled={!activeCompanion || isLoadingDrafts}
              onClick={generateProactiveDrafts}
              title="主动回响"
              type="button"
            >
              <Bell size={18} />
            </button>
            <button
              aria-label="模型调用看板"
              className="icon-button"
              disabled={isLoadingUsage}
              onClick={loadUsageDashboard}
              title="模型调用看板"
              type="button"
            >
              <BarChart3 size={18} />
            </button>
          </div>
        </header>

        <div className="chat-stream">
          <div className="day-divider">{isBooting ? "加载中" : "今天"}</div>
          {messages.map((message) => (
            <article className={`message ${message.role}`} key={message.id}>
              <div
                className={`message-bubble ${
                  getMessageStatus(message) === "failed" ? "failed" : ""
                }`}
              >
                {message.content}
              </div>
              <div className="message-time">
                {message.role === "assistant" ? activeCompanion?.name ?? "关系对象" : "我"} ·{" "}
                {formatTime(message.createdAt)}
                {message.role === "assistant" ? ` · ${formatProviderLabel(message.metadata)}` : ""}
              </div>
              <div className="topbar-actions" aria-label="消息操作">
                {message.role === "assistant" ? (
                  <button
                    aria-label={
                      getMessageStatus(message) === "failed" ? "重试这条回复" : "重新生成这条回复"
                    }
                    className="icon-button"
                    disabled={busyMessageId === message.id}
                    onClick={() => regenerateMessage(message.id)}
                    title={getMessageStatus(message) === "failed" ? "重试回复" : "重新生成回复"}
                    type="button"
                  >
                    <RotateCcw size={16} />
                  </button>
                ) : null}
                <button
                  aria-label={isMessageImportant(message) ? "取消重要标记" : "标记为重要消息"}
                  className={`icon-button ${isMessageImportant(message) ? "active" : ""}`}
                  disabled={busyMessageId === message.id}
                  onClick={() => toggleMessageImportant(message)}
                  title={isMessageImportant(message) ? "取消重要" : "标记重要"}
                  type="button"
                >
                  <Star size={16} />
                </button>
                <button
                  aria-label="删除这条消息"
                  className="icon-button"
                  disabled={busyMessageId === message.id}
                  onClick={() => deleteMessage(message.id)}
                  title="删除消息"
                  type="button"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))}
          {!messages.length && !isBooting ? (
            <div className="empty">这段关系还没有消息，先说第一句话吧</div>
          ) : null}
        </div>

        <form className="composer" onSubmit={sendMessage}>
          <div className="composer-inner">
            <div className="composer-title">
              <h2>{activeCompanion ? `写给 ${activeCompanion.name}` : "选择或新建一个关系"}</h2>
              <span className="pill">
                <Heart size={14} />
                熟悉度 {activeCompanion?.relationshipState.familiarityScore ?? 0}
              </span>
            </div>
            {error ? <div className="error-text">{error}</div> : null}
            <div className="status-line">{status}</div>
            {voicePreview ? (
              <div className="voice-preview">
                <audio controls src={voicePreview.audioDataUrl} />
                <span>
                  {formatVoiceProviderStatus(voicePreview)}
                  {voicePreview.voice ? ` · ${voicePreview.voice}` : ""}
                </span>
                {voicePreview.fallbackReason ? (
                  <span>{redactWorkspaceError(voicePreview.fallbackReason)}</span>
                ) : null}
              </div>
            ) : null}
            <div className="input-row">
              <button
                aria-label={isRecording ? "停止录音" : "语音输入"}
                className={`icon-button composer-icon ${isRecording ? "recording" : ""}`}
                disabled={!activeCompanion || isSending || (isTranscribing && !isRecording)}
                onClick={toggleVoiceRecording}
                title={isRecording ? "停止录音" : "语音输入"}
                type="button"
              >
                <Mic size={18} />
              </button>
              <input
                className="chat-input"
                disabled={!activeCompanion || isSending}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="把想说的话放在这里"
                value={draft}
              />
              <button
                aria-label="朗读最近回复"
                className="icon-button composer-icon"
                disabled={!latestAssistantMessage || isSynthesizing}
                onClick={synthesizeLatestReply}
                title="朗读最近回复"
                type="button"
              >
                <Volume2 size={18} />
              </button>
              <button className="primary-button" disabled={!activeCompanion || isSending} type="submit">
                <Send size={17} />
                {isSending ? "发送中" : "发送"}
              </button>
            </div>
          </div>
        </form>
      </section>

      <aside className="inspector" aria-label="关系资料">
        {inspectorMode === "create" ? (
          <RelationshipObjectForm
            disabled={isSaving}
            errorMessage={formError}
            form={createForm}
            isSaving={isSaving}
            mode="create"
            onCancel={() => setInspectorMode(activeCompanion ? "profile" : "create")}
            onChange={setCreateForm}
            onKindSelect={(kind) =>
              setCreateForm((current) => applyRelationshipKindDefaults(current, kind))
            }
            onSubmit={createCompanion}
          />
        ) : inspectorMode === "edit" && form ? (
          <RelationshipObjectForm
            disabled={isSaving}
            errorMessage={formError}
            form={form}
            isSaving={isSaving}
            mode="edit"
            onCancel={() => {
              setForm(activeCompanion ? toForm(activeCompanion) : null);
              setInspectorMode("profile");
            }}
            onChange={setForm}
            onKindSelect={(kind) =>
              setForm((current) =>
                current ? applyRelationshipKindDefaults(current, kind) : current
              )
            }
            onSubmit={saveCompanion}
          />
        ) : inspectorMode === "memories" ? (
          <>
            <header className="inspector-header">
              <h2>记忆管理</h2>
              <div className="form-actions">
                <button
                  aria-label="返回关系资料"
                  className="icon-button"
                  onClick={() => setInspectorMode("profile")}
                  title="关闭记忆管理"
                  type="button"
                >
                  <Check size={18} />
                </button>
              </div>
            </header>
            <div className="inspector-scroll">
              <section className="panel">
                <div className="panel-title">
                  <h2>候选与长期记忆</h2>
                  <span className="pill">{activeMemories.length} 条</span>
                </div>
                <div className="memory-list">
                  {activeMemories.length ? (
                    activeMemories.map((memory) => (
                      <article className="memory-item" key={memory.id}>
                        <div className="memory-meta">
                          <BookHeart size={14} />
                          {memoryTypeLabels[memory.type]} · {memory.status}
                        </div>
                        {editingMemoryId === memory.id ? (
                          <div className="memory-edit-form">
                            <label className="field">
                              <span>记忆内容</span>
                              <textarea
                                maxLength={500}
                                onChange={(event) => setEditingMemoryContent(event.target.value)}
                                value={editingMemoryContent}
                              />
                            </label>
                            <label className="field">
                              <span>分类</span>
                              <select
                                onChange={(event) =>
                                  setEditingMemoryType(event.target.value as MemoryRecord["type"])
                                }
                                value={editingMemoryType}
                              >
                                {Object.entries(memoryTypeLabels).map(([value, label]) => (
                                  <option key={value} value={value}>
                                    {label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <div className="memory-actions">
                              <button
                                className="text-button"
                                disabled={busyMessageId === memory.id}
                                onClick={() => saveMemoryContent(memory.id)}
                                type="button"
                              >
                                <Check size={15} />
                                保存
                              </button>
                              <button
                                className="text-button"
                                disabled={busyMessageId === memory.id}
                                onClick={() => {
                                  setEditingMemoryId(null);
                                  setEditingMemoryContent("");
                                  setEditingMemoryType("user_fact");
                                }}
                                type="button"
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div>{memory.content}</div>
                        )}
                        <div className="memory-actions">
                          {editingMemoryId !== memory.id ? (
                            <button
                              className="text-button"
                              disabled={busyMessageId === memory.id}
                              onClick={() => startEditMemory(memory)}
                              type="button"
                            >
                              <Edit3 size={15} />
                              编辑
                            </button>
                          ) : null}
                          {memory.status === "pending" ? (
                            <button
                              className="text-button"
                              disabled={busyMessageId === memory.id}
                              onClick={() => updateMemory(memory.id, "active")}
                              type="button"
                            >
                              <Check size={15} />
                              确认
                            </button>
                          ) : null}
                          {memory.status === "active" ? (
                            <button
                              className="text-button"
                              disabled={busyMessageId === memory.id}
                              onClick={() => updateMemory(memory.id, "archived")}
                              type="button"
                            >
                              归档
                            </button>
                          ) : null}
                          {memory.status === "archived" ? (
                            <button
                              className="text-button"
                              disabled={busyMessageId === memory.id}
                              onClick={() => updateMemory(memory.id, "active")}
                              type="button"
                            >
                              恢复
                            </button>
                          ) : null}
                          <button
                            aria-label={`删除记忆：${memory.content.slice(0, 18)}`}
                            className="icon-button"
                            disabled={busyMessageId === memory.id}
                            onClick={() => deleteMemory(memory.id)}
                            title="删除记忆"
                            type="button"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="empty">还没有记忆</div>
                  )}
                </div>
              </section>
            </div>
          </>
        ) : inspectorMode === "import" ? (
          <>
            <header className="inspector-header">
              <h2>导入素材</h2>
              <div className="form-actions">
                <button
                  aria-label="返回关系资料"
                  className="icon-button"
                  onClick={() => setInspectorMode("profile")}
                  title="关闭导入"
                  type="button"
                >
                  <Check size={18} />
                </button>
              </div>
            </header>
            <div className="inspector-scroll">
              <form className="panel" onSubmit={importTextMaterials}>
                <div className="panel-title">
                  <h2>粘贴导入</h2>
                  <span className="pill teal">{importModeLabels[importMode]}</span>
                </div>
                <div className="segmented import-mode-grid" role="group" aria-label="导入模式">
                  {(["single", "batch", "jsonl"] as ImportMode[]).map((mode) => (
                    <button
                      className={`segment ${importMode === mode ? "active" : ""}`}
                      disabled={isImporting}
                      key={mode}
                      onClick={() => {
                        setImportMode(mode);
                        setImportError(null);
                        setImportSummary(null);
                      }}
                      type="button"
                    >
                      {importModeLabels[mode]}
                    </button>
                  ))}
                </div>
                <div className="relationship-type-grid" role="group" aria-label="导入类型">
                  {(["memory_candidate", "tone_sample", "material"] as ImportSourceKind[]).map(
                    (kind) => (
                      <button
                        className={`relationship-type-card ${
                          importSourceKind === kind ? "active" : ""
                        }`}
                        disabled={isImporting}
                        key={kind}
                        onClick={() => setImportSourceKind(kind)}
                        type="button"
                      >
                        <strong>{importSourceLabels[kind]}</strong>
                      </button>
                    )
                  )}
                </div>
                <div className="file-import-row">
                  <label
                    className={`text-button wide ${isImporting ? "disabled" : ""}`}
                    htmlFor="text-material-file"
                  >
                    <Upload size={17} />
                    选择文本文件
                  </label>
                  <input
                    accept=".txt,.jsonl,.json,text/plain,application/json,application/x-ndjson"
                    aria-label="选择文本文件"
                    className="visually-hidden"
                    disabled={!activeCompanion || isImporting}
                    id="text-material-file"
                    onChange={readImportFile}
                    type="file"
                  />
                  <div className="status-box">
                    支持 .txt、.jsonl、.json，最大 {formatBytes(maxImportFileBytes)}；文件只在浏览器读取。
                  </div>
                  {importFileName ? (
                    <div className="status-box">已读取：{importFileName}</div>
                  ) : null}
                </div>
                <div className="panel-title compact-title">
                  <h2>媒体与通讯录</h2>
                  <span className="pill teal">{structuredImportKindLabels[structuredImportKind]}</span>
                </div>
                <div className="segmented import-mode-grid" role="group" aria-label="结构化导入类型">
                  {(["media", "contact"] as StructuredImportKind[]).map((kind) => (
                    <button
                      className={`segment ${structuredImportKind === kind ? "active" : ""}`}
                      disabled={isImporting}
                      key={kind}
                      onClick={() => {
                        setStructuredImportKind(kind);
                        setImportError(null);
                      }}
                      type="button"
                    >
                      {structuredImportKindLabels[kind]}
                    </button>
                  ))}
                </div>
                <div className="file-import-row">
                  <label
                    className={`text-button wide ${isImporting ? "disabled" : ""}`}
                    htmlFor="structured-material-file"
                  >
                    <Upload size={17} />
                    选择{structuredImportKindLabels[structuredImportKind]}
                  </label>
                  <input
                    accept={
                      structuredImportKind === "media"
                        ? "image/*,audio/*,video/*"
                        : ".vcf,.vcard,.csv,.json,text/vcard,text/csv,application/json"
                    }
                    aria-label={`选择${structuredImportKindLabels[structuredImportKind]}`}
                    className="visually-hidden"
                    disabled={!activeCompanion || isImporting}
                    id="structured-material-file"
                    multiple={structuredImportKind === "media"}
                    onChange={readStructuredImportFile}
                    type="file"
                  />
                  <div className="status-box">
                    媒体最多 {structuredImportLimits.maxMediaFiles} 个、单个最大{" "}
                    {formatBytes(structuredImportLimits.maxMediaFileBytes)}；通讯录最大{" "}
                    {formatBytes(structuredImportLimits.maxContactFileBytes)}。原文件不会上传或保存。
                  </div>
                </div>
                <label className="field">
                  <span>{structuredImportKindLabels[structuredImportKind]}说明</span>
                  <textarea
                    disabled={!activeCompanion || isImporting}
                    onChange={(event) => setStructuredImportText(event.target.value)}
                    placeholder={formatStructuredImportPlaceholder(structuredImportKind)}
                    value={structuredImportText}
                  />
                </label>
                <button
                  className="text-button wide"
                  disabled={!activeCompanion || isImporting || !structuredImportText.trim()}
                  onClick={applyStructuredTextImport}
                  type="button"
                >
                  <Upload size={17} />
                  整理为导入文本
                </button>
                <label className="field">
                  <span>{formatImportFieldLabel(importMode)}</span>
                  <textarea
                    disabled={!activeCompanion || isImporting}
                    onChange={(event) => setImportText(event.target.value)}
                    placeholder={formatImportPlaceholder(importMode)}
                    value={importText}
                  />
                </label>
                <div className="status-box">
                  {formatImportModeHint(importMode)}
                </div>
                {importSummary ? (
                  <div className="status-box">
                    {formatImportSummary(importSummary)}
                  </div>
                ) : null}
                {importError ? (
                  <div className="error-box" role="alert">
                    {importError}
                  </div>
                ) : null}
                <button
                  className="primary-button wide"
                  disabled={!activeCompanion || isImporting || !importText.trim()}
                  type="submit"
                >
                  <Upload size={17} />
                  {isImporting ? "导入中" : "导入为候选"}
                </button>
              </form>
            </div>
          </>
        ) : inspectorMode === "proactive" ? (
          <>
            <header className="inspector-header">
              <h2>主动回响</h2>
              <div className="form-actions">
                <button
                  aria-label="重新生成主动回响草稿"
                  className="icon-button"
                  disabled={!activeCompanion || isLoadingDrafts}
                  onClick={generateProactiveDrafts}
                  title="重新生成草稿"
                  type="button"
                >
                  <RotateCcw size={18} />
                </button>
                <button
                  aria-label="返回关系资料"
                  className="icon-button"
                  onClick={() => setInspectorMode("profile")}
                  title="关闭主动回响"
                  type="button"
                >
                  <Check size={18} />
                </button>
              </div>
            </header>
            <div className="inspector-scroll">
              <section className="panel">
                <div className="panel-title">
                  <h2>站内草稿</h2>
                  <span className="pill teal">{formatPersistenceLabel(proactivePersistence)}</span>
                </div>
                {proactiveSafety ? (
                  <div className="status-box">
                    上下文安全：{formatSafetyAction(proactiveSafety)} ·{" "}
                    {proactiveSafety.reason ?? "已通过基础检查"}
                  </div>
                ) : null}
                {proactiveError ? (
                  <div className="error-box" role="alert">
                    {proactiveError}
                  </div>
                ) : null}
                <div className="segmented" aria-label="主动回响状态筛选">
                  {proactiveDraftFilterOptions.map((option) => (
                    <button
                      aria-pressed={proactiveDraftFilter === option.value}
                      className={`segment ${
                        proactiveDraftFilter === option.value ? "active" : ""
                      }`}
                      key={option.value}
                      onClick={() => setProactiveDraftFilter(option.value)}
                      type="button"
                    >
                      {option.label} {proactiveDraftStats[option.value]}
                    </button>
                  ))}
                </div>
                <div className="memory-list">
                  {isLoadingDrafts ? <div className="empty">正在生成主动回响</div> : null}
                  {!isLoadingDrafts && visibleProactiveDrafts.length ? (
                    visibleProactiveDrafts.map((draft) => (
                      <article className="memory-item" key={draft.id}>
                        <div className="memory-meta">
                          <Bell size={14} />
                          {formatDraftKind(draft.kind)} · {formatDraftStatus(
                            draft.status,
                            proactivePersistence
                          )}
                        </div>
                        <div>{draft.content}</div>
                        <div className="memory-meta">{draft.reason}</div>
                        <div className="memory-meta">
                          生成 {formatDateTime(draft.createdAt ?? draft.scheduledAt)}
                          {draft.scheduledAt ? ` · 计划 ${formatDateTime(draft.scheduledAt)}` : ""}
                        </div>
                        <div className="memory-meta">
                          节奏 {draft.frequency?.label ?? "沿用关系设置"}
                          {draft.nextCandidateAt
                            ? ` · 下次候选 ${formatDateTime(draft.nextCandidateAt)}`
                            : ""}
                        </div>
                        <div className="memory-meta">
                          安全 {formatSafetyAction(draft.safety)}
                          {draft.safety?.reason ? ` · ${draft.safety.reason}` : ""}
                        </div>
                        <div className="memory-actions">
                          {draft.status !== "sent" ? (
                            <button
                              className="text-button"
                              disabled={busyMessageId === draft.id}
                              onClick={() => updateProactiveDraftStatus(draft.id, "sent")}
                              type="button"
                            >
                              标记已发送
                            </button>
                          ) : null}
                          {draft.status !== "dismissed" ? (
                            <button
                              className="text-button"
                              disabled={busyMessageId === draft.id}
                              onClick={() => updateProactiveDraftStatus(draft.id, "dismissed")}
                              type="button"
                            >
                              忽略
                            </button>
                          ) : null}
                          {draft.status !== "blocked" ? (
                            <button
                              className="text-button danger"
                              disabled={busyMessageId === draft.id}
                              onClick={() => updateProactiveDraftStatus(draft.id, "blocked")}
                              type="button"
                            >
                              阻断
                            </button>
                          ) : null}
                          {draft.status && draft.status !== "draft" ? (
                            <button
                              className="text-button"
                              disabled={busyMessageId === draft.id}
                              onClick={() => updateProactiveDraftStatus(draft.id, "draft")}
                              type="button"
                            >
                              恢复草稿
                            </button>
                          ) : null}
                        </div>
                      </article>
                    ))
                  ) : null}
                  {!isLoadingDrafts &&
                  proactiveDrafts.length > 0 &&
                  !visibleProactiveDrafts.length &&
                  !proactiveError ? (
                    <div className="empty">
                      当前没有{formatDraftFilterLabel(proactiveDraftFilter)}主动回响
                    </div>
                  ) : null}
                  {!isLoadingDrafts && !proactiveDrafts.length && !proactiveError ? (
                    <div className="empty">当前没有可展示草稿</div>
                  ) : null}
                </div>
              </section>
            </div>
          </>
        ) : inspectorMode === "usage" ? (
          <>
            <header className="inspector-header">
              <h2>调用看板</h2>
              <div className="form-actions">
                <button
                  aria-label="刷新模型调用看板"
                  className="icon-button"
                  disabled={isLoadingUsage}
                  onClick={loadUsageDashboard}
                  title="刷新看板"
                  type="button"
                >
                  <RotateCcw size={18} />
                </button>
                <button
                  aria-label="返回关系资料"
                  className="icon-button"
                  onClick={() => setInspectorMode("profile")}
                  title="关闭调用看板"
                  type="button"
                >
                  <Check size={18} />
                </button>
              </div>
            </header>
            <div className="inspector-scroll">
              <section className="panel">
                <div className="panel-title">
                  <h2>近 {usageDashboard?.rangeDays ?? 7} 天</h2>
                  <span className="pill teal">
                    {usageDashboard?.persistence === "prisma" ? "数据库" : "内存"}
                  </span>
                </div>
                {usageError ? (
                  <div className="error-box" role="alert">
                    {usageError}
                  </div>
                ) : null}
                {isLoadingUsage ? <div className="empty">正在加载调用记录</div> : null}
                {usageDashboard ? (
                  <>
                    <div className="stats">
                      <div className="stat">
                        <span>调用</span>
                        <strong>{usageDashboard.summary.calls}</strong>
                      </div>
                      <div className="stat">
                        <span>失败</span>
                        <strong>{usageDashboard.summary.failedCalls}</strong>
                      </div>
                      <div className="stat">
                        <span>Tokens</span>
                        <strong>{formatCompactNumber(usageDashboard.summary.totalTokens)}</strong>
                      </div>
                      <div className="stat">
                        <span>估算 USD</span>
                        <strong>{formatUsd(usageDashboard.summary.estimatedCostUsd)}</strong>
                      </div>
                    </div>
                    <div className="status-box">
                      输入 {formatCompactNumber(usageDashboard.summary.inputTokens)} · 输出{" "}
                      {formatCompactNumber(usageDashboard.summary.outputTokens)} · 平均延迟{" "}
                      {formatLatency(usageDashboard.summary.averageLatencyMs)}
                    </div>
                  </>
                ) : null}
              </section>

              <section className="panel">
                <div className="panel-title">
                  <h2>模型分布</h2>
                  <span className="pill">估算</span>
                </div>
                <div className="memory-list">
                  {usageDashboard?.byProviderModel.length ? (
                    usageDashboard.byProviderModel.map((item) => (
                      <article className="memory-item" key={`${item.provider}/${item.model}`}>
                        <div className="memory-meta">
                          <BarChart3 size={14} />
                          {item.provider}/{item.model}
                        </div>
                        <div className="usage-row">
                          <span>{item.calls} 次</span>
                          <span>{formatCompactNumber(item.totalTokens)} tokens</span>
                          <span>{formatUsd(item.estimatedCostUsd)}</span>
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="empty">还没有模型调用记录</div>
                  )}
                </div>
              </section>

              <section className="panel">
                <div className="panel-title">
                  <h2>最近记录</h2>
                  <span className="pill">脱敏</span>
                </div>
                <div className="memory-list">
                  {usageDashboard?.recent.length ? (
                    usageDashboard.recent.map((log) => (
                      <article className="memory-item" key={log.id}>
                        <div className="memory-meta">
                          <BarChart3 size={14} />
                          {formatUsagePurpose(log.purpose)} · {formatUsageStatus(log.status)}
                        </div>
                        <div>
                          {log.provider}/{log.model}
                        </div>
                        <div className="memory-meta">
                          {formatDateTime(log.createdAt)} ·{" "}
                          {formatCompactNumber(log.totalTokens ?? 0)} tokens ·{" "}
                          {formatLatency(log.latencyMs)}
                        </div>
                        {log.errorKind ? <div className="memory-meta">错误：{log.errorKind}</div> : null}
                      </article>
                    ))
                  ) : (
                    <div className="empty">暂无最近记录</div>
                  )}
                </div>
              </section>
            </div>
          </>
        ) : (
          <>
            <header className="inspector-header">
              <h2>关系资料</h2>
              <div className="form-actions">
                <button
                  aria-label="新建关系对象"
                  className="icon-button"
                  onClick={startCreateCompanion}
                  title="打开创建表单"
                  type="button"
                >
                  <Plus size={18} />
                </button>
                <button
                  aria-label="编辑当前关系设定"
                  className="icon-button"
                  disabled={!activeCompanion}
                  onClick={startEditCompanion}
                  title="打开关系设定"
                  type="button"
                >
                  <Check size={18} />
                </button>
              </div>
            </header>

            <div className="inspector-scroll">
          <section className="panel">
            <div className="panel-title">
              <h2>对象</h2>
              <span className="pill">已保存</span>
            </div>
            {activeCompanion ? (
              <div className="profile-summary">
                <div className="profile-summary-head">
                  <div className="avatar">{activeCompanion.name.slice(0, 1)}</div>
                  <div>
                    <strong>{activeCompanion.name}</strong>
                    <span>
                      {relationshipKindLabels[activeCompanion.relationshipKind]}
                      {activeCompanion.customKind ? ` / ${activeCompanion.customKind}` : ""}
                    </span>
                  </div>
                </div>
                <dl>
                  <div>
                    <dt>称呼我</dt>
                    <dd>{activeCompanion.userAddress ?? "你"}</dd>
                  </div>
                  <div>
                    <dt>我称呼 TA</dt>
                    <dd>{activeCompanion.companionAddress ?? activeCompanion.name}</dd>
                  </div>
                  <div>
                    <dt>性格</dt>
                    <dd>{activeCompanion.personality.join("、")}</dd>
                  </div>
                  <div>
                    <dt>语气</dt>
                    <dd>{activeCompanion.speakingStyle}</dd>
                  </div>
                  <div>
                    <dt>背景</dt>
                    <dd>{activeCompanion.background ?? "未设置"}</dd>
                  </div>
                  <div>
                    <dt>禁区</dt>
                    <dd>{activeCompanion.boundaries ?? "保持尊重、克制，不制造依赖压力。"}</dd>
                  </div>
                </dl>
                <button className="text-button" onClick={startEditCompanion} type="button">
                  <Edit3 size={17} />
                  编辑设定
                </button>
                <button
                  className="text-button danger"
                  disabled={isSaving}
                  onClick={deleteActiveCompanion}
                  type="button"
                >
                  <Trash2 size={17} />
                  删除关系
                </button>
              </div>
            ) : (
              <div className="empty">选择一个关系后编辑设定</div>
            )}
          </section>

          <section className="panel">
            <div className="panel-title">
              <h2>关系状态</h2>
              <span className="pill teal">
                <MessageCircle size={14} />
                活跃
              </span>
            </div>
            <div className="stats">
              <div className="stat">
                <span>熟悉度</span>
                <strong>{activeCompanion?.relationshipState.familiarityScore ?? 0}</strong>
              </div>
              <div className="stat">
                <span>亲密度</span>
                <strong>{activeCompanion?.relationshipState.closenessScore ?? 0}</strong>
              </div>
              <div className="stat">
                <span>记忆</span>
                <strong>{activeCount}</strong>
              </div>
              <div className="stat">
                <span>待确认</span>
                <strong>{pendingCount}</strong>
              </div>
            </div>
            <div className="status-box">
              最近情绪：{activeCompanion?.relationshipState.recentEmotion ?? "还没有足够线索"}
              <br />
              上次互动：{formatDateTime(
                activeCompanion?.relationshipState.lastInteractionAt ?? undefined
              )}
            </div>
            {activeCompanion?.relationshipState.explanation ? (
              <div className="status-box">{activeCompanion.relationshipState.explanation}</div>
            ) : null}
            <div className="memory-list">
              {activeCompanion?.relationshipState.importantEvents.length ? (
                activeCompanion.relationshipState.importantEvents.slice(0, 4).map((event, index) => (
                  <article className="memory-item" key={`${event}-${index}`}>
                    <div className="memory-meta">
                      <BookHeart size={14} />
                      重要事件
                    </div>
                    <div>{event}</div>
                  </article>
                ))
              ) : (
                <div className="empty">还没有关系时间线</div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">
              <h2>记忆</h2>
              <span className="pill">用户可控</span>
            </div>
            <div className="memory-list">
              {activeMemories.length ? (
                activeMemories.map((memory) => (
                  <article className="memory-item" key={memory.id}>
                    <div className="memory-meta">
                      <BookHeart size={14} />
                      {memoryTypeLabels[memory.type]} · {memory.status}
                    </div>
                    <div>{memory.content}</div>
                  </article>
                ))
              ) : (
                <div className="empty">还没有记忆</div>
              )}
            </div>
          </section>
            </div>
          </>
        )}
      </aside>
    </main>
  );
}

function toForm(companion: CompanionProfile): RelationshipObjectFormState {
  return {
    id: companion.id,
    name: companion.name,
    relationshipKind: companion.relationshipKind,
    customKind: companion.customKind ?? "",
    userAddress: companion.userAddress ?? "",
    companionAddress: companion.companionAddress ?? "",
    personalityText: companion.personality.join("、"),
    speakingStyle: companion.speakingStyle,
    background: companion.background ?? "",
    boundaries: companion.boundaries ?? "",
    immersionEnabled: companion.immersionEnabled,
    proactiveMessagesEnabled: companion.proactiveMessagesEnabled,
    proactiveFrequencyPreset: companion.proactiveFrequencyPreset,
    proactiveFrequencyValue: inferCustomFrequencyValue(
      companion.proactiveFrequencyMinutes
    ).value,
    proactiveFrequencyUnit: inferCustomFrequencyValue(
      companion.proactiveFrequencyMinutes
    ).unit,
    proactiveFrequencyMinutes: companion.proactiveFrequencyMinutes
  };
}

function toCompanionPayload(form: RelationshipObjectFormState) {
  return {
    name: form.name,
    relationshipKind: form.relationshipKind,
    customKind: form.customKind,
    userAddress: form.userAddress,
    companionAddress: form.companionAddress,
    personality: form.personalityText
      .split(/[、,，]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8),
    speakingStyle: form.speakingStyle,
    background: form.background,
    boundaries: form.boundaries,
    immersionEnabled: form.immersionEnabled,
    proactiveMessagesEnabled: form.proactiveMessagesEnabled,
    proactiveFrequencyPreset: form.proactiveFrequencyPreset,
    proactiveFrequencyMinutes: form.proactiveFrequencyMinutes
  };
}

async function readResponseError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { error?: unknown };
    return typeof payload.error === "string" && payload.error.trim()
      ? redactWorkspaceError(payload.error, fallback)
      : fallback;
  } catch {
    return fallback;
  }
}

function toSafeWorkspaceError(error: unknown, fallback: string) {
  return redactWorkspaceError(error instanceof Error ? error.message : fallback, fallback);
}

function redactWorkspaceError(message: string, fallback = "操作失败，请稍后重试。") {
  const trimmed = message.trim();
  if (!trimmed) return fallback;

  return [
    {
      pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
      replacement: "Bearer [已隐藏]"
    },
    {
      pattern: /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}\b/g,
      replacement: "[已隐藏 API Key]"
    },
    {
      pattern: /\b(?:github_pat_[A-Za-z0-9_]{16,}|gh[pousr]_[A-Za-z0-9_]{16,})\b/g,
      replacement: "[已隐藏 API Key]"
    },
    {
      pattern: /\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^\s"',;<>]+["']?/gi,
      replacement: "[已隐藏敏感字段]"
    },
    {
      pattern: /https?:\/\/[^\s"',;<>]+/gi,
      replacement: "[已隐藏 Base URL]"
    },
    {
      pattern: /\b(?:prompt|rawPayload|stack)\b/gi,
      replacement: "[已隐藏调试字段]"
    },
    {
      pattern: /\bat\s+\S+\s+\([^)]*\)/gi,
      replacement: "[已隐藏堆栈]"
    }
  ].reduce((current, item) => current.replace(item.pattern, item.replacement), trimmed);
}

function canRecordVoice() {
  return (
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined"
  );
}

function readSupportedAudioMimeType() {
  if (typeof MediaRecorder === "undefined") return "";

  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus"
  ];

  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("录音读取失败。"));
    reader.onloadend = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.readAsDataURL(blob);
  });
}

function audioExtensionFromMimeType(mimeType: string) {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

function formatVoiceProviderStatus(payload: {
  provider?: string;
  requestedProvider?: string;
  model?: string;
  credentialSource?: "server-env" | "user-vault";
  fallback?: boolean;
  fallbackKind?: string;
}) {
  const provider = payload.provider ?? "unknown";
  const model = payload.model ?? "unknown";
  const source =
    payload.credentialSource === "user-vault"
      ? "用户 vault"
      : payload.credentialSource === "server-env"
        ? "环境变量"
        : "默认配置";
  const requested = payload.requestedProvider && payload.requestedProvider !== provider
    ? ` · from ${payload.requestedProvider}`
    : "";
  const fallback = payload.fallback
    ? ` · mock fallback${payload.fallbackKind ? `/${payload.fallbackKind}` : ""}`
    : "";

  return `${provider}/${model} · ${source}${requested}${fallback}`;
}

function readImportFileExtension(fileName: string) {
  const normalized = fileName.toLowerCase();
  return allowedImportFileExtensions.find((extension) => normalized.endsWith(extension)) ?? null;
}

function normalizeImportFileText(
  rawText: string,
  extension: (typeof allowedImportFileExtensions)[number]
): { text: string; mode: ImportMode } {
  const text = rawText.trim();

  if (extension === ".jsonl") {
    return { text, mode: "jsonl" };
  }

  if (extension === ".json") {
    try {
      const parsed = JSON.parse(text) as unknown;
      const items = Array.isArray(parsed) ? parsed : [parsed];
      return {
        text: items.map((item) => JSON.stringify(item)).join("\n"),
        mode: "jsonl"
      };
    } catch {
      throw new Error("JSON 文件无法解析，请检查格式后再导入。");
    }
  }

  return { text, mode: "single" };
}

function buildImportRequest(mode: ImportMode, text: string, sourceKind: ImportSourceKind) {
  if (mode === "batch") {
    return {
      batchTexts: text.split(/\r?\n/),
      sourceKind
    };
  }

  if (mode === "jsonl") {
    return {
      jsonLines: text,
      sourceKind
    };
  }

  return {
    text,
    sourceKind
  };
}

function formatImportFieldLabel(mode: ImportMode) {
  if (mode === "batch") return "每行一条";
  if (mode === "jsonl") return "JSON Lines";
  return "文本";
}

function formatImportPlaceholder(mode: ImportMode) {
  if (mode === "batch") {
    return "一行一段素材，例如：\n她说话喜欢先轻轻喊我的名字\n我们的纪念日是 5 月 20 日";
  }

  if (mode === "jsonl") {
    return '{"text":"她说话喜欢先轻轻喊我的名字","sourceKind":"tone_sample"}\n{"content":"我们的纪念日是 5 月 20 日","sourceKind":"material"}';
  }

  return "粘贴聊天片段、设定补充、语气样例或想让 TA 记住的事实";
}

function formatStructuredImportPlaceholder(kind: StructuredImportKind) {
  if (kind === "contact") {
    return '可粘贴 vCard、CSV 或 JSON，例如：\n[{"name":"阿澈","relationship":"朋友","phone":"13800000000","note":"高中时总陪我晚自习"}]';
  }

  return '可粘贴照片/音频/视频说明，例如：\n[{"title":"五月海边","description":"那天 TA 说以后难过就来海边吹风","people":"我和 TA","date":"2024-05-20"}]';
}

function formatImportModeHint(mode: ImportMode) {
  if (mode === "batch") {
    return "每行会作为一条输入逐条脱敏；导入后先进入 pending，确认后进入 active。";
  }

  if (mode === "jsonl") {
    return '每行一个 JSON，可用 text、content 或 message；sourceKind 可覆盖为 material、tone_sample 或 memory_candidate。';
  }

  return "导入后先进入 pending，确认后进入 active；也可以归档或删除。";
}

function formatBytes(value: number) {
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.round(value / 1024)}KB`;
}

function formatImportSummary(summary: ImportSummary) {
  const parts = [
    `${importModeLabels[summary.mode]} · 已生成 ${summary.createdCount} 条`,
    `已移除疑似密钥 ${summary.redactionCount} 处`,
    `跳过 ${summary.skippedCount} 段`
  ];

  if (typeof summary.inputCount === "number") {
    parts.push(`输入 ${summary.inputCount} 条`);
  }

  if (typeof summary.acceptedCount === "number") {
    parts.push(`接受 ${summary.acceptedCount} 条`);
  }

  if (summary.truncatedCount) {
    parts.push(`截断 ${summary.truncatedCount} 条`);
  }

  if (summary.parseSkippedCount) {
    parts.push(`解析跳过 ${summary.parseSkippedCount} 行`);
  }

  if (summary.duplicateCount) {
    parts.push(`本次重复 ${summary.duplicateCount} 条`);
  }

  if (summary.existingDuplicateCount) {
    parts.push(`已存在 ${summary.existingDuplicateCount} 条`);
  }

  if (summary.limit) {
    parts.push(
      `上限 ${summary.limit.maxItems} 条 / 单条 ${summary.limit.maxItemChars} 字 / 候选 ${summary.limit.maxCandidates} 条`
    );
  }

  return parts.join(" · ");
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getMessageStatus(message: MessageRecord) {
  return typeof message.metadata?.status === "string" ? message.metadata.status : "sent";
}

function isMessageImportant(message: MessageRecord) {
  return message.metadata?.important === true;
}

function formatProviderLabel(
  metadata:
    | MessageRecord["metadata"]
    | { provider?: string; model?: string; status?: number }
    | null
    | undefined
) {
  const provider = typeof metadata?.provider === "string" ? metadata.provider : "unknown";
  const model = typeof metadata?.model === "string" ? metadata.model : "unknown";
  return `${provider}/${model}`;
}

function formatPersistenceLabel(value: string | null) {
  if (value === "mock") return "mock 草稿";
  if (value === "memory") return "内存草稿";
  if (value === "prisma") return "数据库草稿";
  if (value === "persisted") return "已持久化";
  if (value) return value;
  return "待生成";
}

function formatDraftKind(kind: string) {
  const labels: Record<string, string> = {
    ANNIVERSARY: "纪念日",
    DAILY_GREETING: "日常问候",
    EMOTION_CARE: "情绪关怀",
    LAST_CONVERSATION_FOLLOWUP: "承接上次",
    PLAYFUL_MISS_YOU: "撒娇式"
  };

  return labels[kind] ?? kind;
}

function formatDraftStatus(status: string | undefined, persistence: string | null) {
  if (!status) return persistence === "mock" ? "mock 预览" : "草稿";

  const labels: Record<string, string> = {
    DRAFT: "草稿",
    draft: "草稿",
    SENT: "已发送",
    sent: "已发送",
    DISMISSED: "已忽略",
    dismissed: "已忽略",
    BLOCKED: "已拦截",
    blocked: "已拦截"
  };

  return labels[status] ?? status;
}

function normalizeDraftStatus(status: string | undefined): ProactiveDraftStatus {
  const normalized = status?.toLowerCase();

  if (
    normalized === "sent" ||
    normalized === "dismissed" ||
    normalized === "blocked" ||
    normalized === "draft"
  ) {
    return normalized;
  }

  return "draft";
}

function formatDraftFilterLabel(filter: ProactiveDraftFilter) {
  const labels: Record<ProactiveDraftFilter, string> = {
    all: "全部",
    draft: "草稿",
    sent: "已发送",
    dismissed: "已忽略",
    blocked: "已拦截"
  };

  return labels[filter];
}

function formatDateTime(value: string | undefined) {
  if (!value) return "未记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未记录";

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatSafetyAction(safety: DraftSafety | null | undefined) {
  if (!safety) return "未记录";

  const labels: Record<string, string> = {
    allow: "通过",
    block: "拦截",
    boundary_response: "边界回应",
    revise: "已改写"
  };

  return labels[safety.action ?? ""] ?? safety.action ?? (safety.ok ? "通过" : "需复核");
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1
  }).format(value);
}

function formatUsd(value: number) {
  if (value <= 0) return "$0";
  return `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
}

function formatLatency(value: number | null | undefined) {
  if (value == null) return "未记录";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${value}ms`;
}

function formatUsageStatus(status: string) {
  const labels: Record<string, string> = {
    success: "成功",
    error: "失败"
  };

  return labels[status] ?? status;
}

function formatUsagePurpose(purpose: string) {
  const labels: Record<string, string> = {
    chat_reply: "聊天回复",
    chat_regenerate: "重新生成",
    chat_complete_api: "补全 API",
    proactive_draft: "主动草稿",
    safety_check: "安全检查",
    other: "其他"
  };

  return labels[purpose] ?? purpose;
}
