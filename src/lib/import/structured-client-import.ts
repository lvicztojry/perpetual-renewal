export type StructuredImportKind = "media" | "contact";

export type StructuredImportSourceKind = "material" | "memory_candidate";

export type StructuredImportItem = {
  text: string;
  sourceKind: StructuredImportSourceKind;
};

export type StructuredImportPlan = {
  items: StructuredImportItem[];
  skippedCount: number;
  warnings: string[];
};

export type StructuredImportFile = {
  name: string;
  type: string;
  size: number;
  lastModified?: number;
};

export const structuredImportLimits = {
  maxMediaFiles: 12,
  maxMediaFileBytes: 8 * 1024 * 1024,
  maxContactFileBytes: 512 * 1024,
  maxStructuredTextChars: 12_000,
  maxContacts: 25,
  maxMediaDescriptions: 25
} as const;

const allowedMediaMimePrefixes = ["image/", "audio/", "video/"] as const;
const allowedMediaExtensions = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".heic",
  ".heif",
  ".mp3",
  ".wav",
  ".m4a",
  ".ogg",
  ".mp4",
  ".mov",
  ".webm"
] as const;
const allowedContactExtensions = [".vcf", ".vcard", ".csv", ".json"] as const;

export function createMediaFileImportPlan(files: StructuredImportFile[]): StructuredImportPlan {
  const acceptedFiles = files.slice(0, structuredImportLimits.maxMediaFiles);
  const warnings: string[] = [];
  let skippedCount = Math.max(0, files.length - acceptedFiles.length);

  const items = acceptedFiles.flatMap((file) => {
    if (!isAllowedMediaFile(file)) {
      skippedCount += 1;
      warnings.push(`已跳过 ${file.name}：只支持照片、音频或视频文件。`);
      return [];
    }

    if (file.size > structuredImportLimits.maxMediaFileBytes) {
      skippedCount += 1;
      warnings.push(
        `已跳过 ${file.name}：单个媒体文件不能超过 ${formatStructuredBytes(
          structuredImportLimits.maxMediaFileBytes
        )}。`
      );
      return [];
    }

    return [
      {
        sourceKind: "material" as const,
        text: [
          `媒体素材：${formatMediaKind(file.type)}「${file.name}」`,
          `类型：${file.type || "未知"}`,
          `大小：${formatStructuredBytes(file.size)}`,
          file.lastModified ? `本地修改时间：${formatStructuredDate(file.lastModified)}` : "",
          "隐私边界：原始文件仅在浏览器被读取为素材说明，未上传或保存。"
        ]
          .filter(Boolean)
          .join("；")
      }
    ];
  });

  return { items, skippedCount, warnings };
}

export function createStructuredTextImportPlan(input: {
  kind: StructuredImportKind;
  text: string;
}): StructuredImportPlan {
  const text = input.text.trim().slice(0, structuredImportLimits.maxStructuredTextChars);
  if (!text) {
    return { items: [], skippedCount: 0, warnings: ["请先粘贴结构化素材。"] };
  }

  return input.kind === "media"
    ? createMediaDescriptionImportPlan(text)
    : createContactTextImportPlan(text);
}

export function createContactFileImportPlan(input: {
  fileName: string;
  fileText: string;
  fileSize: number;
}): StructuredImportPlan {
  const extension = readContactFileExtension(input.fileName);
  if (!extension) {
    return {
      items: [],
      skippedCount: 1,
      warnings: ["只支持 .vcf、.vcard、.csv、.json 通讯录文件。"]
    };
  }

  if (input.fileSize > structuredImportLimits.maxContactFileBytes) {
    return {
      items: [],
      skippedCount: 1,
      warnings: [
        `通讯录文件不能超过 ${formatStructuredBytes(
          structuredImportLimits.maxContactFileBytes
        )}。`
      ]
    };
  }

  return createContactTextImportPlan(input.fileText, extension);
}

export function isAllowedMediaFile(file: StructuredImportFile) {
  const type = file.type.trim().toLowerCase();
  if (allowedMediaMimePrefixes.some((prefix) => type.startsWith(prefix))) {
    return true;
  }

  return allowedMediaExtensions.some((extension) => file.name.toLowerCase().endsWith(extension));
}

export function readContactFileExtension(fileName: string) {
  const normalized = fileName.toLowerCase();
  return allowedContactExtensions.find((extension) => normalized.endsWith(extension)) ?? null;
}

function createMediaDescriptionImportPlan(text: string): StructuredImportPlan {
  const records = parseStructuredRecords(text);
  const acceptedRecords = records.slice(0, structuredImportLimits.maxMediaDescriptions);
  const skippedCount = Math.max(0, records.length - acceptedRecords.length);

  const items = acceptedRecords
    .map((record) => formatMediaDescription(record))
    .filter(Boolean)
    .map((description) => ({
      sourceKind: "material" as const,
      text: description
    }));

  return {
    items,
    skippedCount: skippedCount + Math.max(0, acceptedRecords.length - items.length),
    warnings: []
  };
}

function createContactTextImportPlan(text: string, extension?: string | null): StructuredImportPlan {
  const records = parseContactRecords(text, extension);
  const acceptedRecords = records.slice(0, structuredImportLimits.maxContacts);
  let skippedCount = Math.max(0, records.length - acceptedRecords.length);

  const items = acceptedRecords
    .map((record) => {
      const formatted = formatContactRecord(record);
      if (!formatted) {
        skippedCount += 1;
        return null;
      }

      return {
        sourceKind: "memory_candidate" as const,
        text: formatted
      };
    })
    .filter((item): item is { sourceKind: "memory_candidate"; text: string } => item !== null);

  return { items, skippedCount, warnings: [] };
}

function parseStructuredRecords(text: string): Array<Record<string, unknown> | string> {
  const parsed = parseJsonLike(text);
  if (parsed) {
    return parsed;
  }

  return text
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseContactRecords(text: string, extension?: string | null): Array<Record<string, unknown> | string> {
  if (extension === ".vcf" || extension === ".vcard" || /BEGIN:VCARD/i.test(text)) {
    return parseVcards(text);
  }

  if (extension === ".csv" || looksLikeCsv(text)) {
    return parseCsvContacts(text);
  }

  const parsed = parseJsonLike(text);
  if (parsed) {
    return parsed;
  }

  return text
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseJsonLike(text: string): Array<Record<string, unknown> | string> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") return item as Record<string, unknown>;
        return null;
      })
      .filter((item): item is Record<string, unknown> | string => item !== null);
  } catch {
    return null;
  }
}

function parseVcards(text: string) {
  return text
    .split(/END:VCARD/i)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      return {
        name: readVcardValue(lines, "FN") ?? readVcardValue(lines, "N"),
        phone: readVcardValue(lines, "TEL"),
        email: readVcardValue(lines, "EMAIL"),
        note: readVcardValue(lines, "NOTE")
      };
    });
}

function readVcardValue(lines: string[], key: string) {
  const line = lines.find((entry) => entry.toUpperCase().startsWith(`${key}`));
  if (!line) return undefined;
  const [, ...parts] = line.split(":");
  return parts.join(":").replace(/;/g, " ").trim();
}

function parseCsvContacts(text: string) {
  const rows = text
    .split(/\r?\n/)
    .map((line) => parseCsvLine(line).map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean));

  if (!rows.length) return [];

  const headers = rows[0].map(normalizeContactKey);
  const hasHeader = headers.some((header) =>
    ["name", "displayname", "fullname", "姓名", "关系", "relationship", "phone", "mobilephone", "email", "emailaddress", "备注", "note", "notes"].includes(
      header
    )
  );

  const dataRows = hasHeader ? rows.slice(1) : rows;
  return dataRows.map((row) => {
    if (!hasHeader) {
      return {
        name: row[0],
        relationship: row[1],
        note: row.slice(2).filter(Boolean).join("；")
      };
    }

    return Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
  });
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

function looksLikeCsv(text: string) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim());
  return Boolean(firstLine?.includes(","));
}

function formatMediaDescription(record: Record<string, unknown> | string) {
  if (typeof record === "string") {
    return record ? `媒体说明：${record}` : "";
  }

  const title =
    readRecordString(record, ["title", "name", "fileName", "filename", "文件名", "标题"]) ??
    "未命名素材";
  const description =
    readRecordString(record, ["description", "caption", "text", "content", "说明", "描述"]) ?? "";
  const people = readRecordString(record, ["people", "person", "人物", "对象"]);
  const date = readRecordString(record, ["date", "time", "takenAt", "时间", "日期"]);
  const place = readRecordString(record, ["place", "location", "地点", "位置"]);
  const note = readRecordString(record, ["note", "备注"]);

  if (!description && !people && !date && !place && !note) {
    return "";
  }

  return [
    `媒体说明：「${title}」`,
    description ? `描述：${description}` : "",
    people ? `人物：${people}` : "",
    date ? `时间：${date}` : "",
    place ? `地点：${place}` : "",
    note ? `补充：${note}` : "",
    "隐私边界：原始照片、音频或视频未上传或保存。"
  ]
    .filter(Boolean)
    .join("；");
}

function formatContactRecord(record: Record<string, unknown> | string) {
  if (typeof record === "string") {
    return record ? `联系人条目：${record}` : "";
  }

  const name = readRecordString(record, ["name", "displayName", "fn", "姓名", "昵称"]);
  if (!name) return "";

  const relationship = readRecordString(record, ["relationship", "relation", "关系", "身份"]);
  const address = readRecordString(record, ["address", "称呼"]);
  const note = readRecordString(record, ["note", "notes", "memo", "备注", "content"]);
  const phone = readRecordString(record, ["phone", "phones", "tel", "telephone", "mobile", "mobilePhone", "电话", "手机号"]);
  const email = readRecordString(record, ["email", "emails", "mail", "emailAddress", "eMailAddress", "邮箱"]);
  const contactSummary = [maskPhone(phone), maskEmail(email)].filter(Boolean).join("、");

  return [
    `联系人条目：${name}`,
    relationship ? `关系：${relationship}` : "",
    address ? `称呼：${address}` : "",
    contactSummary ? `联系方式摘要：${contactSummary}` : "",
    note ? `备注：${note}` : "",
    "隐私边界：通讯录原文件未上传或保存，电话和邮箱默认只保留脱敏摘要。"
  ]
    .filter(Boolean)
    .join("；");
}

function readRecordString(record: Record<string, unknown>, keys: string[]) {
  const normalizedEntries = new Map(
    Object.entries(record).map(([key, value]) => [normalizeContactKey(key), value])
  );

  for (const key of keys) {
    const value = record[key] ?? normalizedEntries.get(normalizeContactKey(key));
    const text = readStructuredValue(value);
    if (text) return text;
  }

  return undefined;
}

function readStructuredValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const text = readStructuredValue(item);
      if (text) return text;
    }
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      readStructuredValue(record.value) ??
      readStructuredValue(record.number) ??
      readStructuredValue(record.phone) ??
      readStructuredValue(record.email) ??
      readStructuredValue(record.address) ??
      readStructuredValue(record.text)
    );
  }

  return undefined;
}

function normalizeContactKey(key: string) {
  return key.replace(/[\s_\-./]+/g, "").toLowerCase();
}

function maskPhone(value: string | undefined) {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  return `电话尾号 ${digits.slice(-4)}`;
}

function maskEmail(value: string | undefined) {
  if (!value) return "";
  const [, domain] = value.split("@");
  if (!domain) return "邮箱已脱敏";
  return `邮箱域 ${domain}`;
}

function formatMediaKind(mimeType: string) {
  if (mimeType.startsWith("image/")) return "照片";
  if (mimeType.startsWith("audio/")) return "音频";
  if (mimeType.startsWith("video/")) return "视频";
  return "媒体";
}

function formatStructuredDate(value: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";
  return date.toLocaleDateString("zh-CN");
}

function formatStructuredBytes(value: number) {
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(value / 1024))}KB`;
}
