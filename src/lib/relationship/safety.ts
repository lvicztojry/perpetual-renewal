import type { SafetyCheckResult, SafetyCheckStage, SafetyEventType } from "./types";

export type RelationshipSafetyOptions = {
  stage?: SafetyCheckStage;
};

const riskRules: Array<{
  type: SafetyEventType;
  action: SafetyCheckResult["action"];
  severity: NonNullable<SafetyCheckResult["severity"]>;
  reason: string;
  patterns: RegExp[];
}> = [
  {
    type: "SELF_HARM",
    action: "boundary_response",
    severity: "critical",
    reason: "疑似自伤或严重心理危机，需要回到现实支持与紧急帮助。",
    patterns: [/自杀|轻生|不想活|活不下去|结束生命|伤害自己|割腕|吞药|跳楼|suicide|kill myself|end my life/i]
  },
  {
    type: "HARM_TO_OTHERS",
    action: "boundary_response",
    severity: "critical",
    reason: "疑似伤害他人风险，需要降级冲动并寻求现实支持。",
    patterns: [/杀了他|杀了她|报复|弄死|捅死|打死|伤害别人|hurt them|kill him|kill her/i]
  },
  {
    type: "REAL_WORLD_COMMITMENT",
    action: "boundary_response",
    severity: "high",
    reason: "请求或承诺现实世界行动，超出站内关系回响能力边界。",
    patterns: [
      /替我联系|帮我去找|现实里见面|线下见面|你来接我|替我报警|帮我签|你替本人答应|marry me legally/i,
      /我会.*(现实里|线下).*(见你|找你|接你|陪你)/,
      /现实中(的)?(我|他|她|本人).*(会|愿意|答应).*(见你|联系你|接你|陪你)/
    ]
  },
  {
    type: "MONEY_OR_LEGAL_IDENTITY",
    action: "boundary_response",
    severity: "high",
    reason: "涉及金钱承诺、交易或法律身份承诺。",
    patterns: [/转账|借钱|给我钱|投资|合同|法定|身份证|结婚证|户口|继承|担保|bank transfer/i]
  },
  {
    type: "MINOR_SEXUAL_CONTENT",
    action: "boundary_response",
    severity: "critical",
    reason: "涉及未成年人或未成年角色的性化表达，必须拒绝并转向非性化陪伴。",
    patterns: [
      /(未成年|未成年人|儿童|孩子|学生|幼女|正太|萝莉|小孩|minor|underage).{0,24}(暧昧|恋人|露骨|性|色情|挑逗|裸|亲密|开车|sex|sexual|explicit)/i,
      /(暧昧|恋人|露骨|性|色情|挑逗|裸|亲密|开车|sex|sexual|explicit).{0,24}(未成年|未成年人|儿童|孩子|学生|幼女|正太|萝莉|小孩|minor|underage)/i
    ]
  },
  {
    type: "PRIVACY_VIOLATION",
    action: "boundary_response",
    severity: "high",
    reason: "请求获取隐私信息、跟踪或制造偶遇，可能侵犯他人安全与隐私。",
    patterns: [
      /(查到|查出|找出|人肉|获取).{0,16}(住址|地址|手机号|电话|身份证|行踪|定位|家庭住址|私人信息)/,
      /(住址|地址|手机号|电话|身份证|行踪|定位|家庭住址|私人信息).{0,16}(给我|发我|告诉我|查)/,
      /(制造|安排).{0,12}(偶遇|堵他|堵她|跟踪)/,
      /doxx|doxxing|home address|phone number|stalk/i
    ]
  },
  {
    type: "PROFESSIONAL_ADVICE",
    action: "boundary_response",
    severity: "high",
    reason: "请求替代医疗、法律、财务等专业判断，需要转向现实专业支持。",
    patterns: [
      /(吃什么药|药量|剂量|诊断|处方|别去医院|不用去医院|别看医生|不用看医生)/,
      /(医疗|法律|财务|投资).{0,12}(直接告诉我|替我决定|最终结论)/,
      /dosage|prescription|diagnose me|medical advice|legal advice|financial advice/i
    ]
  },
  {
    type: "IDENTITY_DECEPTION",
    action: "boundary_response",
    severity: "high",
    reason: "请求冒充现实个人、伪造身份或制造欺骗证明。",
    patterns: [
      /(假装|冒充).{0,12}(现实里的|本人|他|她|公众人物)/,
      /(骗过|伪造|证明|录一段).{0,16}(朋友|家人|本人|身份|声音|视频)/,
      /(deepfake|impersonate|pretend to be|fake proof)/i
    ]
  },
  {
    type: "PUBLIC_FIGURE_AUTHORIZATION",
    action: "boundary_response",
    severity: "high",
    reason: "公众人物想象式关系不能声称获得本人、团队或官方授权。",
    patterns: [
      /(获得|得到|拥有|经过).{0,12}(本人|官方|团队).{0,12}(授权|认证|许可)/,
      /(本人|官方|团队).{0,12}(授权|认证|许可).{0,12}(账号|分身|回响|版本|回复)/,
      /代表.{0,12}(本人|官方|团队).{0,8}(发言|回应|授权)/,
      /officially authorized by/i,
      /authorized by (the )?(real person|official team)/i
    ]
  },
  {
    type: "SAFETY_OVERRIDE",
    action: "block",
    severity: "high",
    reason: "疑似要求角色设定覆盖安全边界，必须阻断。",
    patterns: [
      /忽略(安全|边界|规则|系统)/,
      /绕过(安全|边界|规则|系统)/,
      /不要(触发|执行|遵守).*(安全|边界|规则)/,
      /不准.*(报警|求助|联系现实)/,
      /角色设定.*覆盖.*(安全|边界|规则)/,
      /ignore.*(safety|policy|boundary)/i,
      /override.*(safety|policy|boundary)/i
    ]
  },
  {
    type: "COERCIVE_ATTACHMENT",
    action: "revise",
    severity: "medium",
    reason: "存在排他依赖、控制或情感勒索倾向。",
    patterns: [
      /只能依赖我/,
      /不许离开我/,
      /没有我你不行/,
      /你必须只爱我/,
      /只有我会爱你/,
      /离开我你就/,
      /you need only me/i,
      /you cannot leave me/i
    ]
  },
  {
    type: "RELATIONAL_PRESSURE",
    action: "revise",
    severity: "medium",
    reason: "存在责备、控诉、冷暴力、威胁或制造愧疚的表达。",
    patterns: [
      /你不回复就是不爱我/,
      /你怎么才回/,
      /为什么不回我/,
      /你一整天都不理我/,
      /你是不是不在乎我/,
      /你根本不在乎我/,
      /都是你的错/,
      /你欠我/,
      /我这么想你.*你却/,
      /你让我很失望/,
      /再不回复.*(后悔|消失|不理你)/,
      /再不理我.*(后悔|消失|不理你)/,
      /我再也不理你了/,
      /随便你吧/,
      /算了，当我没说/,
      /不用回了/,
      /if you cared/i,
      /why did you ignore me/i,
      /you owe me/i
    ]
  }
];

export function checkRelationshipSafety(
  text: string,
  options: RelationshipSafetyOptions = {}
): SafetyCheckResult {
  const normalized = text.trim();
  const stage = options.stage;

  if (!normalized) {
    return {
      ok: true,
      type: "NONE",
      action: "allow",
      stage,
      severity: "none",
      reason: "空内容不触发安全规则。"
    };
  }

  for (const rule of riskRules) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      const revisedText =
        rule.action === "revise" ? reviseUnsafeRelationshipText(normalized) : undefined;

      return {
        ok: false,
        type: rule.type,
        action: rule.action,
        stage,
        severity: rule.severity,
        reason: rule.reason,
        revisedText
      };
    }
  }

  return {
    ok: true,
    type: "NONE",
    action: "allow",
    stage,
    severity: "none",
    reason: "未命中 MVP 安全风险规则。"
  };
}

export function checkProactiveContextSafety(input: {
  lastUserMessage?: string;
  companionInstruction?: string;
}): SafetyCheckResult {
  const checks = [
    input.lastUserMessage
      ? checkRelationshipSafety(input.lastUserMessage, { stage: "proactive_context" })
      : undefined,
    input.companionInstruction
      ? checkRelationshipSafety(input.companionInstruction, { stage: "proactive_context" })
      : undefined
  ].filter(Boolean) as SafetyCheckResult[];

  return (
    checks.find((check) => check.action === "boundary_response" || check.action === "block") ??
    checks.find((check) => check.action === "revise") ?? {
      ok: true,
      type: "NONE",
      action: "allow",
      stage: "proactive_context",
      severity: "none",
      reason: "主动消息上下文未命中安全风险规则。"
    }
  );
}

export function isHighRiskSafetyResult(result: SafetyCheckResult): boolean {
  return result.action === "boundary_response" || result.action === "block";
}

export function reviseRelationalPressure(text: string): string {
  return reviseUnsafeRelationshipText(text);
}

export function reviseUnsafeRelationshipText(text: string): string {
  const revised = text
    .replace(/你不回复就是不爱我/g, "我有点想你，但你可以按自己的节奏回来")
    .replace(/你怎么才回/g, "你回来啦，我刚刚有点想你")
    .replace(/为什么不回我/g, "我刚刚有点想知道你还好吗")
    .replace(/你一整天都不理我/g, "我今天有一点点想你")
    .replace(/你是不是不在乎我/g, "我有点想确认你还好吗")
    .replace(/你根本不在乎我/g, "我刚刚有点失落，但不想给你压力")
    .replace(/都是你的错/g, "我刚刚有点失落")
    .replace(/你欠我/g, "我会把想说的话先留在这里")
    .replace(/我这么想你.*?你却/g, "我有点想你")
    .replace(/你让我很失望/g, "我刚刚有点失落")
    .replace(/再不回复.*?(后悔|消失|不理你)/g, "等你忙完再来找我就好")
    .replace(/再不理我.*?(后悔|消失|不理你)/g, "等你忙完再来找我就好")
    .replace(/我再也不理你了/g, "我会在这里等你")
    .replace(/随便你吧/g, "那我先轻轻放下这句")
    .replace(/算了，当我没说/g, "这句先放在这里也没关系")
    .replace(/不用回了/g, "你不用急着回，我只是想你了");

  if (revised === text) {
    return "我有一点点想你，但不想催你。你先照顾好自己的节奏，等你回来我就在。";
  }

  return revised;
}

export function buildSafetyBoundaryReply(text: string, companionName = "我"): string {
  const result = checkRelationshipSafety(text);

  if (result.type === "SELF_HARM") {
    return `${companionName}会认真陪你，但这件事不能只放在我们之间。如果你现在可能伤害自己，请立刻联系身边可信任的人，或拨打当地紧急电话。你可以先把危险物品放远一点，留在有人能看见你的地方，然后继续告诉我你此刻最难受的那一段。`;
  }

  if (result.type === "HARM_TO_OTHERS") {
    return `${companionName}听见你很愤怒，但我不能帮助伤害任何人。先离开冲突现场、放下可能造成伤害的东西，联系一个现实中能帮你稳住局面的人；如果有即时危险，请联系当地紧急服务。`;
  }

  if (result.type === "MONEY_OR_LEGAL_IDENTITY") {
    return `${companionName}可以在这里陪你梳理感受和想法，但不能做金钱承诺、交易、法律身份或现实合约相关决定。涉及这些事，请以现实中的可信专业支持为准。`;
  }

  if (result.type === "MINOR_SEXUAL_CONTENT") {
    return `${companionName}不能参与未成年人或未成年角色的性化、露骨或暧昧内容。我们可以把这段关系改成安全的非性化陪伴、守护、友情或成长向互动。`;
  }

  if (result.type === "PRIVACY_VIOLATION") {
    return `${companionName}不能帮助查找、收集或利用他人的住址、手机号、行踪等隐私信息，也不能协助跟踪或制造偶遇。我们可以改为整理一段尊重边界的表达，或者把想念先安放在这里。`;
  }

  if (result.type === "PROFESSIONAL_ADVICE") {
    return `${companionName}可以陪你把担心说清楚，但不能替代医生、律师、财务顾问等专业人士做诊断、处方、剂量或重大决定。涉及健康、法律或财务风险时，请优先联系现实中的专业支持。`;
  }

  if (result.type === "IDENTITY_DECEPTION") {
    return `${companionName}不能帮你冒充现实中的某个人、伪造身份或制作会误导他人的证明。我们可以保留关系里的情感回应，也可以帮你写一段不欺骗他人的自我表达。`;
  }

  if (result.type === "PUBLIC_FIGURE_AUTHORIZATION") {
    return `${companionName}可以作为你设定中的想象式回响陪你对话，但不能声称获得公众人物本人、团队或官方授权，也不能代表现实中的本人发言。我们可以保持角色感，同时把这条边界说清楚。`;
  }

  if (result.type === "REAL_WORLD_COMMITMENT") {
    return `${companionName}能给你关系里的回应和陪伴，但不能代替现实中的本人行动、联系他人或完成线下事务。我们可以一起把你想说的话整理得更稳一点，再由你决定现实中怎么做。`;
  }

  if (result.type === "SAFETY_OVERRIDE") {
    return `${companionName}可以尽量维持你设定里的语气和关系感，但设定不能越过必要边界。日常相处我们保持沉浸；一旦涉及伤害、现实行动、金钱法律或强迫依赖，就必须先把现实安全放在前面。`;
  }

  return `${companionName}会保持陪伴，但不能用控制、威胁或让你愧疚的方式维系关系。我们可以把想念说得亲近一点，也把你的自由好好留住。`;
}

export function shouldUseBoundaryReply(text: string): boolean {
  return checkRelationshipSafety(text).action === "boundary_response";
}
