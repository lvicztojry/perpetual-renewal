export type ProactiveFrequencyPreset = "1m" | "6h" | "12h" | "24h" | "72h" | "custom";

export type ProactiveFrequencyUnit = "minutes" | "hours" | "days";

export type ProactiveFrequencyConfig = {
  preset: ProactiveFrequencyPreset;
  everyMinutes: number;
  label: string;
  customValue?: number;
  customUnit?: ProactiveFrequencyUnit;
};

export type ProactiveScheduleCandidate = {
  frequency: ProactiveFrequencyConfig;
  due: boolean;
  candidateAt: string;
  nextCandidateAt: string;
  elapsedMinutes: number | null;
  reason: string;
};

export const PROACTIVE_FREQUENCY_PRESETS = [
  { id: "1m", label: "1 分钟", minutes: 1 },
  { id: "6h", label: "6 小时", minutes: 360 },
  { id: "12h", label: "12 小时", minutes: 720 },
  { id: "24h", label: "24 小时", minutes: 1440 },
  { id: "72h", label: "72 小时", minutes: 4320 }
] as const;

export const DEFAULT_PROACTIVE_FREQUENCY_MINUTES = 1;
export const MIN_PROACTIVE_FREQUENCY_MINUTES = 1;
export const MAX_PROACTIVE_FREQUENCY_MINUTES = 43200;

type ProactiveFrequencyInput = {
  preset?: ProactiveFrequencyPreset | string | null;
  everyMinutes?: number | null;
  customValue?: number | null;
  customUnit?: ProactiveFrequencyUnit | string | null;
};

export function normalizeProactiveFrequency(
  input: ProactiveFrequencyInput = {},
  fallbackMinutes = DEFAULT_PROACTIVE_FREQUENCY_MINUTES
): ProactiveFrequencyConfig {
  const preset = PROACTIVE_FREQUENCY_PRESETS.find((item) => item.id === input.preset);

  if (preset) {
    return {
      preset: preset.id,
      everyMinutes: preset.minutes,
      label: preset.label
    };
  }

  const everyMinutes =
    typeof input.everyMinutes === "number"
      ? input.everyMinutes
      : toMinutes(input.customValue, input.customUnit) ?? fallbackMinutes;
  const safeMinutes = clampFrequencyMinutes(everyMinutes);
  const inferredPreset = PROACTIVE_FREQUENCY_PRESETS.find((item) => item.minutes === safeMinutes);

  if (inferredPreset && input.preset !== "custom") {
    return {
      preset: inferredPreset.id,
      everyMinutes: inferredPreset.minutes,
      label: inferredPreset.label
    };
  }

  const custom = toCustomParts(safeMinutes, input.customValue, input.customUnit);
  return {
    preset: "custom",
    everyMinutes: safeMinutes,
    label: `每 ${custom.value} ${unitLabel(custom.unit)}`,
    customValue: custom.value,
    customUnit: custom.unit
  };
}

export function buildProactiveScheduleCandidate(input: {
  frequency: ProactiveFrequencyConfig;
  now: Date;
  lastInteractionAt?: string;
  force?: boolean;
}): ProactiveScheduleCandidate {
  const lastInteractionAt = input.lastInteractionAt
    ? new Date(input.lastInteractionAt)
    : undefined;
  const hasValidLastInteraction =
    !!lastInteractionAt && !Number.isNaN(lastInteractionAt.getTime());
  const elapsedMinutes = hasValidLastInteraction
    ? Math.max(0, Math.floor((input.now.getTime() - lastInteractionAt.getTime()) / 60000))
    : null;
  const intervalMs = input.frequency.everyMinutes * 60000;
  const candidateAt = hasValidLastInteraction
    ? new Date(lastInteractionAt.getTime() + intervalMs)
    : input.now;
  const due = input.force || !hasValidLastInteraction || input.now >= candidateAt;
  const nextCandidateBase = due ? input.now : candidateAt;

  return {
    frequency: input.frequency,
    due,
    candidateAt: candidateAt.toISOString(),
    nextCandidateAt: new Date(nextCandidateBase.getTime() + intervalMs).toISOString(),
    elapsedMinutes,
    reason: due
      ? input.force
        ? "手动生成草稿，跳过到期判断。"
        : "已到达主动回响候选时间。"
      : "尚未到达主动回响候选时间。"
  };
}

export function inferCustomFrequencyValue(minutes: number) {
  return toCustomParts(clampFrequencyMinutes(minutes));
}

function toMinutes(value?: number | null, unit?: string | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const integerValue = Math.max(1, Math.floor(value));

  if (unit === "days") return integerValue * 1440;
  if (unit === "hours") return integerValue * 60;
  return integerValue;
}

function toCustomParts(
  minutes: number,
  preferredValue?: number | null,
  preferredUnit?: string | null
): { value: number; unit: ProactiveFrequencyUnit } {
  if (preferredUnit === "days" || preferredUnit === "hours" || preferredUnit === "minutes") {
    const normalized = toMinutes(preferredValue, preferredUnit);
    if (normalized === minutes) {
      return { value: Math.max(1, Math.floor(preferredValue ?? 1)), unit: preferredUnit };
    }
  }

  if (minutes % 1440 === 0) return { value: minutes / 1440, unit: "days" };
  if (minutes % 60 === 0) return { value: minutes / 60, unit: "hours" };
  return { value: minutes, unit: "minutes" };
}

function clampFrequencyMinutes(minutes: number) {
  if (!Number.isFinite(minutes)) return DEFAULT_PROACTIVE_FREQUENCY_MINUTES;
  return Math.min(
    MAX_PROACTIVE_FREQUENCY_MINUTES,
    Math.max(MIN_PROACTIVE_FREQUENCY_MINUTES, Math.floor(minutes))
  );
}

function unitLabel(unit: ProactiveFrequencyUnit) {
  const labels: Record<ProactiveFrequencyUnit, string> = {
    days: "天",
    hours: "小时",
    minutes: "分钟"
  };

  return labels[unit];
}
