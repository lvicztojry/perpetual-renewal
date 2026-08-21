import { NextRequest, NextResponse } from "next/server";
import {
  createBatchTextImportPlan,
  createTextImportPlan,
  normalizeImportedMemoryContent,
  parseJsonLinesImport
} from "@/lib/import/text-import";
import {
  textImportSourceKinds,
  type BatchTextImportItem,
  type TextImportSourceKind
} from "@/lib/import/types";
import { getCurrentSession } from "@/lib/auth/session";
import { JsonRequestError, jsonErrorMessage, readJsonObject } from "@/lib/http/json";
import { createRenewalRepository } from "@/lib/renewal/repository";

type RouteContext = {
  params: Promise<{
    companionId: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { companionId } = await context.params;
  let body: unknown;
  let importRequest: ReturnType<typeof readImportRequest>;

  try {
    body = await readJsonObject(request);
    importRequest = readImportRequest(body);
  } catch (error) {
    if (error instanceof ImportRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof JsonRequestError) {
      return NextResponse.json(
        { error: jsonErrorMessage(error, "Failed to import text.") },
        { status: 400 }
      );
    }

    throw error;
  }

  const session = await getCurrentSession();
  const repo = createRenewalRepository();
  const companion = await repo.getCompanion(session.userId, companionId);

  if (!companion) {
    return NextResponse.json({ error: "Companion not found" }, { status: 404 });
  }

  const plan =
    importRequest.mode === "single"
      ? createTextImportPlan({
          text: importRequest.text,
          sourceKind: importRequest.sourceKind
        })
      : createBatchTextImportPlan({
          items: importRequest.items,
          defaultSourceKind: importRequest.sourceKind
        });

  const parseSkippedCount = importRequest.mode === "single" ? 0 : importRequest.skippedCount;

  if (!plan.candidates.length) {
    return NextResponse.json(
      {
        error: "没有找到可导入候选。",
        redactionCount: plan.redactionCount,
        skippedCount: plan.skippedCount + parseSkippedCount,
        importSummary: buildImportSummary(importRequest.mode, plan, 0, parseSkippedCount)
      },
      { status: 400 }
    );
  }

  const existingMemoryKeys = new Set(
    companion.memories
      .filter((memory) => memory.status !== "deleted")
      .map((memory) => normalizeImportedMemoryContent(memory.content))
  );
  let existingDuplicateCount = 0;
  const importableCandidates = plan.candidates.filter((candidate) => {
    const key = normalizeImportedMemoryContent(candidate.content);
    if (existingMemoryKeys.has(key)) {
      existingDuplicateCount += 1;
      return false;
    }

    existingMemoryKeys.add(key);
    return true;
  });

  if (!importableCandidates.length) {
    return NextResponse.json(
      {
        error: "这些内容已存在，没有新增候选。",
        redactionCount: plan.redactionCount,
        skippedCount: plan.skippedCount + parseSkippedCount + existingDuplicateCount,
        importSummary: buildImportSummary(
          importRequest.mode,
          plan,
          0,
          parseSkippedCount,
          existingDuplicateCount
        )
      },
      { status: 400 }
    );
  }

  const memories = [];
  for (const candidate of importableCandidates) {
    memories.push(
      await repo.createMemory(session.userId, companionId, {
        sourceMessageId: null,
        type: candidate.type,
        status: "pending",
        content: candidate.content,
        confidence: candidate.confidence
      })
    );
  }

  return NextResponse.json(
    {
      memories,
      importSummary: buildImportSummary(
        importRequest.mode,
        plan,
        memories.length,
        parseSkippedCount,
        existingDuplicateCount
      ),
      persistence: repo.persistence
    },
    { status: 201 }
  );
}

function readImportRequest(body: unknown):
  | {
      mode: "single";
      text: string;
      sourceKind?: string;
    }
  | {
      mode: "batch";
      items: BatchTextImportItem[];
      sourceKind?: string;
      skippedCount: number;
    }
  | {
      mode: "jsonl";
      items: BatchTextImportItem[];
      sourceKind?: string;
      skippedCount: number;
    } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ImportRequestError("JSON object body is required");
  }

  const record = body as Record<string, unknown>;
  const sourceKind = readString(record.sourceKind);
  const batchPayload =
    readBatchPayload(record.batchTexts) ?? readBatchPayload(record.texts) ?? readBatchPayload(record.batch);

  if (batchPayload) {
    return {
      mode: "batch",
      items: batchPayload.items,
      sourceKind,
      skippedCount: batchPayload.skippedCount
    };
  }

  const jsonLines = readString(record.jsonLines) ?? readString(record.jsonl);
  if (jsonLines) {
    const parsed = parseJsonLinesImport(jsonLines);
    return {
      mode: "jsonl",
      items: parsed.items,
      sourceKind,
      skippedCount: parsed.skippedCount
    };
  }

  const text = readString(record.text);
  if (!text) {
    throw new ImportRequestError("text, batchTexts, texts, batch, jsonLines, or jsonl is required");
  }

  return {
    mode: "single",
    text,
    sourceKind
  };
}

function readBatchPayload(value: unknown): { items: BatchTextImportItem[]; skippedCount: number } | undefined {
  if (!Array.isArray(value)) return undefined;

  let skippedCount = 0;
  const items = value
    .map((item) => {
      if (typeof item === "string") {
        if (item.trim()) return { text: item };
        skippedCount += 1;
        return null;
      }

      if (!item || typeof item !== "object") {
        skippedCount += 1;
        return null;
      }

      const record = item as Record<string, unknown>;
      const text = readString(record.text) ?? readString(record.content) ?? readString(record.message);
      if (!text) {
        skippedCount += 1;
        return null;
      }

      const sourceKind = readSourceKind(record.sourceKind);
      return sourceKind ? { text, sourceKind } : { text };
    })
    .filter((item): item is BatchTextImportItem => item !== null);

  return { items, skippedCount };
}

function readSourceKind(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return textImportSourceKinds.includes(normalized as TextImportSourceKind)
    ? (normalized as TextImportSourceKind)
    : undefined;
}

function buildImportSummary(
  mode: "single" | "batch" | "jsonl",
  plan: ReturnType<typeof createTextImportPlan> | ReturnType<typeof createBatchTextImportPlan>,
  createdCount: number,
  parseSkippedCount = 0,
  existingDuplicateCount = 0
) {
  const batchPlan = "inputCount" in plan ? plan : undefined;

  return {
    mode,
    sourceKind: plan.candidates[0]?.sourceKind ?? "memory_candidate",
    createdCount,
    skippedCount: plan.skippedCount + parseSkippedCount + existingDuplicateCount,
    redactionCount: plan.redactionCount,
    duplicateCount: plan.duplicateCount,
    existingDuplicateCount,
    inputCount: batchPlan?.inputCount ?? (mode === "single" ? 1 : 0),
    acceptedCount: batchPlan?.acceptedCount ?? (mode === "single" ? 1 : 0),
    truncatedCount: batchPlan?.truncatedCount ?? 0,
    parseSkippedCount,
    limit: batchPlan?.limit,
    lifecycle: ["pending", "active", "archived", "deleted"]
  };
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}

class ImportRequestError extends Error {}
