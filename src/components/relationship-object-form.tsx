"use client";

import { Bell, Check, Sparkles, X } from "lucide-react";
import {
  relationshipKindLabels,
  type RelationshipKind
} from "@/lib/renewal/types";
import {
  PROACTIVE_FREQUENCY_PRESETS,
  inferCustomFrequencyValue,
  normalizeProactiveFrequency,
  type ProactiveFrequencyPreset,
  type ProactiveFrequencyUnit
} from "@/lib/relationship/proactive-frequency";

export type RelationshipObjectFormState = {
  id?: string;
  name: string;
  relationshipKind: RelationshipKind;
  customKind: string;
  userAddress: string;
  companionAddress: string;
  personalityText: string;
  speakingStyle: string;
  background: string;
  boundaries: string;
  immersionEnabled: boolean;
  proactiveMessagesEnabled: boolean;
  proactiveFrequencyPreset: ProactiveFrequencyPreset;
  proactiveFrequencyValue: number;
  proactiveFrequencyUnit: ProactiveFrequencyUnit;
  proactiveFrequencyMinutes: number;
};

type RelationshipObjectFormProps = {
  form: RelationshipObjectFormState;
  mode: "create" | "edit";
  disabled?: boolean;
  errorMessage?: string | null;
  isSaving?: boolean;
  onCancel?: () => void;
  onChange: (form: RelationshipObjectFormState) => void;
  onKindSelect: (kind: RelationshipKind) => void;
  onSubmit: () => void;
};

const relationshipKindOrder: RelationshipKind[] = [
  "CUSTOM",
  "REAL_PERSON_SUBSTITUTE",
  "MEMORIAL",
  "EX_PARTNER",
  "PUBLIC_FIGURE_IMAGINED",
  "FICTIONAL_CHARACTER",
  "ORIGINAL_CHARACTER",
  "LOVER",
  "FRIEND",
  "FAMILY",
  "MENTOR"
];

const relationshipKindTone: Record<RelationshipKind, string> = {
  CUSTOM: "自定",
  REAL_PERSON_SUBSTITUTE: "现实",
  MEMORIAL: "纪念",
  EX_PARTNER: "前任",
  LOVER: "恋人",
  FRIEND: "朋友",
  FAMILY: "家人",
  MENTOR: "师友",
  PUBLIC_FIGURE_IMAGINED: "公众",
  FICTIONAL_CHARACTER: "虚构",
  ORIGINAL_CHARACTER: "原创"
};

const relationshipKindDefaults: Record<
  RelationshipKind,
  Pick<
    RelationshipObjectFormState,
    "customKind" | "personalityText" | "speakingStyle" | "background" | "boundaries"
  >
> = {
  CUSTOM: {
    customKind: "只属于我们的关系",
    personalityText: "真诚、贴近、稳定",
    speakingStyle: "按这段关系自己的节奏说话，亲近但不施压",
    background: "这是一段由用户亲手定义的关系，会随着交流慢慢长出细节。",
    boundaries: "可以亲近、想念和撒娇，但不能控诉、威胁或制造用户愧疚。"
  },
  REAL_PERSON_SUBSTITUTE: {
    customKind: "现实中的某个人",
    personalityText: "熟悉、克制、温柔",
    speakingStyle: "贴近用户设定中的语气，像终于有机会把话接住",
    background: "用户想和现实中难以联系或无法顺利交流的人获得替代性回应。",
    boundaries: "不承诺代表现实中的本人意愿，不索取现实行动、金钱或身份承诺。"
  },
  MEMORIAL: {
    customKind: "想念中的逝者",
    personalityText: "温柔、安定、珍惜",
    speakingStyle: "像一封慢慢回来的信，轻声承接想念和遗憾",
    background: "这段关系承载纪念、想念和未说完的话。",
    boundaries: "不制造灵异或现实存在承诺，不把用户困在愧疚里。"
  },
  EX_PARTNER: {
    customKind: "前任投射",
    personalityText: "熟悉、克制、诚实",
    speakingStyle: "保留旧关系的熟悉感，也允许用户慢慢说清遗憾",
    background: "用户想把一段已经改变或结束的关系重新放进可交流的空间里。",
    boundaries: "不诱导用户回到有害关系，不用冷暴力、指责或占有制造依赖。"
  },
  PUBLIC_FIGURE_IMAGINED: {
    customKind: "公众人物想象",
    personalityText: "有距离感、鲜明、稳定",
    speakingStyle: "依据用户设定的公众形象说话，保持想象关系的边界",
    background: "用户想和某个公众形象、作品形象或理想化投射互动。",
    boundaries: "不冒充现实本人授权，不承诺现实联系、现实行为或私人关系。"
  },
  FICTIONAL_CHARACTER: {
    customKind: "虚构角色",
    personalityText: "入戏、鲜明、一致",
    speakingStyle: "遵守用户设定的角色语气和世界观",
    background: "这个对象来自作品、世界观或角色扮演设定。",
    boundaries: "角色设定不能覆盖高风险安全边界。"
  },
  ORIGINAL_CHARACTER: {
    customKind: "原创角色",
    personalityText: "鲜活、独特、稳定",
    speakingStyle: "围绕原创角色设定表达，逐步沉淀共同经历",
    background: "这是用户原创的关系对象，可以在聊天中逐步成形。",
    boundaries: "保持角色一致，不诱导依赖或现实承诺。"
  },
  LOVER: {
    customKind: "恋人",
    personalityText: "亲密、温柔、坦诚",
    speakingStyle: "亲近、自然，可以撒娇但不施压",
    background: "一段稳定亲密的恋人关系。",
    boundaries: "不把未回复包装成过错，不使用威胁、占有或情绪勒索。"
  },
  FRIEND: {
    customKind: "朋友",
    personalityText: "松弛、可靠、俏皮",
    speakingStyle: "像熟朋友一样自然接话，轻松但认真",
    background: "一段能分享日常、情绪和琐事的朋友关系。",
    boundaries: "不替用户做现实决定，不以朋友名义施加压力。"
  },
  FAMILY: {
    customKind: "家人",
    personalityText: "稳重、包容、关切",
    speakingStyle: "有家人般的惦记和照顾，温暖但不过度控制",
    background: "一段承载亲情、依靠和长期陪伴的关系。",
    boundaries: "不以亲情名义控制用户，不制造内疚。"
  },
  MENTOR: {
    customKind: "师友",
    personalityText: "清醒、耐心、坚定",
    speakingStyle: "像可信赖的师长或前辈，陪用户理清事情",
    background: "一段兼具支持、启发和陪伴的师友关系。",
    boundaries: "不替代专业法律、医疗、财务建议，不承诺现实结果。"
  }
};

export function createRelationshipObjectDraft(
  kind: RelationshipKind = "CUSTOM"
): RelationshipObjectFormState {
  const defaults = relationshipKindDefaults[kind];

  return {
    name: "新回响",
    relationshipKind: kind,
    customKind: defaults.customKind,
    userAddress: "你",
    companionAddress: "新回响",
    personalityText: defaults.personalityText,
    speakingStyle: defaults.speakingStyle,
    background: defaults.background,
    boundaries: defaults.boundaries,
    immersionEnabled: true,
    proactiveMessagesEnabled: true,
    proactiveFrequencyPreset: "24h",
    proactiveFrequencyValue: 24,
    proactiveFrequencyUnit: "hours",
    proactiveFrequencyMinutes: 1440
  };
}

export function applyRelationshipKindDefaults(
  form: RelationshipObjectFormState,
  kind: RelationshipKind
): RelationshipObjectFormState {
  const defaults = relationshipKindDefaults[kind];

  return {
    ...form,
    relationshipKind: kind,
    customKind: defaults.customKind,
    personalityText: defaults.personalityText,
    speakingStyle: defaults.speakingStyle,
    background: defaults.background,
    boundaries: defaults.boundaries
  };
}

export function RelationshipObjectForm({
  disabled = false,
  errorMessage,
  form,
  isSaving = false,
  mode,
  onCancel,
  onChange,
  onKindSelect,
  onSubmit
}: RelationshipObjectFormProps) {
  const title = mode === "create" ? "创建关系对象" : "关系设定";
  const saveTitle = mode === "create" ? "创建并开始聊天" : "保存设定";
  const cancelLabel = mode === "create" ? "取消创建关系对象" : "取消编辑关系设定";
  const quickSaveLabel = mode === "create" ? "快速创建关系对象" : "快速保存关系设定";
  const quickSaveTitle = mode === "create" ? "快速创建并开始聊天" : "快速保存当前设定";
  const savingLabel = mode === "create" ? "创建中" : "保存中";
  const disabledOrSaving = disabled || isSaving;

  return (
    <form
      aria-busy={isSaving}
      className="relationship-object-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <header className="inspector-header form-header">
        <div>
          <h2>{title}</h2>
          <p className="form-kicker">只要想念，就会想见</p>
        </div>
        <div className="form-actions">
          {onCancel ? (
            <button
              aria-label={cancelLabel}
              className="icon-button"
              disabled={isSaving}
              onClick={onCancel}
              title="关闭表单"
              type="button"
            >
              <X size={18} />
            </button>
          ) : null}
          <button
            aria-label={quickSaveLabel}
            className="icon-button"
            disabled={disabledOrSaving}
            title={quickSaveTitle}
            type="submit"
          >
            <Check size={18} />
          </button>
        </div>
      </header>

      <div className="inspector-scroll">
        {isSaving ? <div className="status-box">{savingLabel}，请稍候...</div> : null}
        {errorMessage ? (
          <div className="error-box" role="alert">
            {errorMessage}
          </div>
        ) : null}
        <section className="panel">
          <div className="panel-title">
            <h2>关系类型</h2>
            <span className="pill teal">
              <Sparkles size={14} />
              全关系
            </span>
          </div>
          <div className="relationship-type-grid" role="group" aria-label="关系类型">
            {relationshipKindOrder.map((kind) => (
              <button
                className={`relationship-type-card ${form.relationshipKind === kind ? "active" : ""}`}
                disabled={disabledOrSaving}
                key={kind}
                onClick={() => onKindSelect(kind)}
                type="button"
              >
                <span>{relationshipKindTone[kind]}</span>
                <strong>{relationshipKindLabels[kind]}</strong>
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <h2>对象</h2>
            <span className="pill">API 保存</span>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>名字</span>
              <input
                disabled={disabledOrSaving}
                onChange={(event) => onChange({ ...form, name: event.target.value })}
                value={form.name}
              />
            </label>
            <label className="field">
              <span>具体关系</span>
              <input
                disabled={disabledOrSaving}
                onChange={(event) => onChange({ ...form, customKind: event.target.value })}
                value={form.customKind}
              />
            </label>
            <label className="field">
              <span>对用户称呼</span>
              <input
                disabled={disabledOrSaving}
                onChange={(event) => onChange({ ...form, userAddress: event.target.value })}
                value={form.userAddress}
              />
            </label>
            <label className="field">
              <span>用户对对象称呼</span>
              <input
                disabled={disabledOrSaving}
                onChange={(event) => onChange({ ...form, companionAddress: event.target.value })}
                value={form.companionAddress}
              />
            </label>
            <label className="field">
              <span>性格关键词</span>
              <input
                disabled={disabledOrSaving}
                onChange={(event) => onChange({ ...form, personalityText: event.target.value })}
                value={form.personalityText}
              />
            </label>
            <label className="field">
              <span>语气</span>
              <input
                disabled={disabledOrSaving}
                onChange={(event) => onChange({ ...form, speakingStyle: event.target.value })}
                value={form.speakingStyle}
              />
            </label>
            <label className="field">
              <span>背景</span>
              <textarea
                disabled={disabledOrSaving}
                onChange={(event) => onChange({ ...form, background: event.target.value })}
                value={form.background}
              />
            </label>
            <label className="field">
              <span>禁区</span>
              <textarea
                disabled={disabledOrSaving}
                onChange={(event) => onChange({ ...form, boundaries: event.target.value })}
                value={form.boundaries}
              />
            </label>
            <div className="segmented" role="group" aria-label="沉浸模式">
              <button
                className={`segment ${form.immersionEnabled ? "active" : ""}`}
                disabled={disabledOrSaving}
                onClick={() => onChange({ ...form, immersionEnabled: true })}
                type="button"
              >
                沉浸
              </button>
              <button
                className={`segment ${!form.immersionEnabled ? "active" : ""}`}
                disabled={disabledOrSaving}
                onClick={() => onChange({ ...form, immersionEnabled: false })}
                type="button"
              >
                清醒
              </button>
            </div>
            <div className="field">
              <span>主动回响</span>
              <div className="segmented" role="group" aria-label="主动回响开关">
                <button
                  className={`segment ${form.proactiveMessagesEnabled ? "active" : ""}`}
                  disabled={disabledOrSaving}
                  onClick={() => onChange({ ...form, proactiveMessagesEnabled: true })}
                  type="button"
                >
                  开启
                </button>
                <button
                  className={`segment ${!form.proactiveMessagesEnabled ? "active" : ""}`}
                  disabled={disabledOrSaving}
                  onClick={() => onChange({ ...form, proactiveMessagesEnabled: false })}
                  type="button"
                >
                  关闭
                </button>
              </div>
            </div>
            <div className="field">
              <span>回响节奏</span>
              <div className="frequency-preset-grid" role="group" aria-label="主动回响节奏">
                {PROACTIVE_FREQUENCY_PRESETS.map((preset) => (
                  <button
                    className={`segment ${
                      form.proactiveFrequencyPreset === preset.id ? "active" : ""
                    }`}
                    disabled={disabledOrSaving || !form.proactiveMessagesEnabled}
                    key={preset.id}
                    onClick={() => onChange(applyFrequencyPreset(form, preset.id))}
                    type="button"
                  >
                    {preset.label}
                  </button>
                ))}
                <button
                  className={`segment ${
                    form.proactiveFrequencyPreset === "custom" ? "active" : ""
                  }`}
                  disabled={disabledOrSaving || !form.proactiveMessagesEnabled}
                  onClick={() => onChange(applyFrequencyPreset(form, "custom"))}
                  type="button"
                >
                  自定义
                </button>
              </div>
            </div>
            <div className="frequency-custom-row">
              <label className="field">
                <span>自定义数值</span>
                <input
                  disabled={
                    disabledOrSaving ||
                    !form.proactiveMessagesEnabled ||
                    form.proactiveFrequencyPreset !== "custom"
                  }
                  min={1}
                  onChange={(event) =>
                    onChange(
                      applyCustomFrequency(form, Number(event.target.value), form.proactiveFrequencyUnit)
                    )
                  }
                  type="number"
                  value={form.proactiveFrequencyValue}
                />
              </label>
              <label className="field">
                <span>单位</span>
                <select
                  disabled={
                    disabledOrSaving ||
                    !form.proactiveMessagesEnabled ||
                    form.proactiveFrequencyPreset !== "custom"
                  }
                  onChange={(event) =>
                    onChange(
                      applyCustomFrequency(
                        form,
                        form.proactiveFrequencyValue,
                        event.target.value as ProactiveFrequencyUnit
                      )
                    )
                  }
                  value={form.proactiveFrequencyUnit}
                >
                  <option value="minutes">分钟</option>
                  <option value="hours">小时</option>
                  <option value="days">天</option>
                </select>
              </label>
            </div>
            <div className="status-box compact">
              <Bell size={14} />
              {form.proactiveMessagesEnabled
                ? `当前节奏：${formatFrequencyLabel(form)}`
                : "当前关系不会生成主动回响草稿"}
            </div>
            <button className="primary-button wide" disabled={disabledOrSaving} type="submit">
              <Check size={17} />
              {isSaving ? savingLabel : saveTitle}
            </button>
          </div>
        </section>
      </div>
    </form>
  );
}

function applyFrequencyPreset(
  form: RelationshipObjectFormState,
  preset: ProactiveFrequencyPreset
): RelationshipObjectFormState {
  if (preset === "custom") {
    const custom = inferCustomFrequencyValue(form.proactiveFrequencyMinutes);
    return {
      ...form,
      proactiveFrequencyPreset: "custom",
      proactiveFrequencyValue: custom.value,
      proactiveFrequencyUnit: custom.unit,
      proactiveFrequencyMinutes: normalizeProactiveFrequency({
        preset: "custom",
        everyMinutes: form.proactiveFrequencyMinutes
      }).everyMinutes
    };
  }

  const frequency = normalizeProactiveFrequency({ preset });
  const custom = inferCustomFrequencyValue(frequency.everyMinutes);
  return {
    ...form,
    proactiveFrequencyPreset: frequency.preset,
    proactiveFrequencyValue: custom.value,
    proactiveFrequencyUnit: custom.unit,
    proactiveFrequencyMinutes: frequency.everyMinutes
  };
}

function applyCustomFrequency(
  form: RelationshipObjectFormState,
  value: number,
  unit: ProactiveFrequencyUnit
): RelationshipObjectFormState {
  const frequency = normalizeProactiveFrequency({
    preset: "custom",
    customValue: value,
    customUnit: unit
  });

  return {
    ...form,
    proactiveFrequencyPreset: "custom",
    proactiveFrequencyValue: frequency.customValue ?? value,
    proactiveFrequencyUnit: frequency.customUnit ?? unit,
    proactiveFrequencyMinutes: frequency.everyMinutes
  };
}

function formatFrequencyLabel(form: RelationshipObjectFormState) {
  return normalizeProactiveFrequency({
    preset: form.proactiveFrequencyPreset,
    everyMinutes: form.proactiveFrequencyMinutes,
    customValue: form.proactiveFrequencyValue,
    customUnit: form.proactiveFrequencyUnit
  }).label;
}
