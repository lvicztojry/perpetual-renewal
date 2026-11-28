import type { CourseDefinition } from "./types";

const course = (value: CourseDefinition): CourseDefinition => value;

export const peopleCourse = course({
  id: "people", title: "认识人物", chapterTitle: "人物 · 归处", contentVersion: 1,
  prerequisite: "前提：至少创建一位人物。",
  fallbackCopy: "还没有人物。先完成主线的创建，或点「想见谁」。",
  steps: [
    { id: "people-switch", kind: "read", target: "people-list", dialogue: ["每个人物都住在左边这一列。"], instruction: "点击不同名字切换人物，看看聊天如何跟着变。", completion: { type: "confirm" }, next: "people-profile", requires: "companion" },
    { id: "people-profile", kind: "navigate", target: "open-profile", dialogue: ["想仔细看看 TA 的时候，资料就在这里。"], instruction: "点击「人物资料」，打开资料面板。", completion: { type: "confirm" }, next: "people-edit", requires: "companion" },
    { id: "people-edit", kind: "navigate", target: "open-edit", dialogue: ["名字、称呼、性情，都可以在这里改。"], instruction: "点击「人物设置」，进入编辑表单。", completion: { type: "confirm" }, next: "people-save", requires: "companion" },
    { id: "people-save", kind: "action", target: "person-submit", dialogue: ["改好之后记得保存。"], instruction: "修改后点击「保存设定」，保存这个人物。", completion: { type: "evidence", kind: "companion-updated" }, next: "people-proactive", requires: "companion" },
    { id: "people-proactive", kind: "read", target: "person-proactive", dialogue: ["主动回响表示 TA 会在你安静时也想起你。"], instruction: "认识「主动回响」开关与节奏，暂时不用改。", completion: { type: "confirm" }, next: "people-end", requires: "companion" },
    { id: "people-end", kind: "story", dialogue: ["认得归处，就不会走散。"], instruction: "这条支线先到这里。", completion: { type: "confirm" }, next: null }
  ]
});

export const chatCourse = course({
  id: "chat", title: "把话说完", chapterTitle: "私聊 · 回声", contentVersion: 1,
  prerequisite: "前提：至少创建一位人物。",
  fallbackCopy: "还没有可以聊天的人物。先创建一位，再回来。",
  steps: [
    { id: "chat-input", kind: "input", target: "chat-input", dialogue: ["一句话就可以开始。"], instruction: "点击输入框，写一句想说的话。", completion: { type: "confirm" }, next: "chat-send", requires: "companion" },
    { id: "chat-send", kind: "action", target: "chat-send", dialogue: ["寄出去，才算真的说出口。"], instruction: "点击「发送」。", completion: { type: "evidence", kind: "message-sent" }, next: "chat-status", requires: "companion" },
    { id: "chat-status", kind: "read", target: "chat-status", dialogue: ["发送中、失败、重试，状态都在这里说清楚。"], instruction: "看一眼输入框附近的状态提示。失败时可以重新发送。", completion: { type: "confirm" }, next: "chat-regenerate", requires: "companion" },
    { id: "chat-regenerate", kind: "read", target: "chat-regenerate", dialogue: ["如果那句不太像 TA，可以再请一次。"], instruction: "认识「重新生成」入口，是否使用由你决定。", completion: { type: "confirm" }, next: "chat-message-tools", requires: "companion" },
    { id: "chat-message-tools", kind: "read", target: "chat-last-reply", policy: "free", dialogue: ["重要的消息可以标记，也可以删除；这些都由你做主。"], instruction: "认识消息旁的重要标记与删除，不必真的删除记录。", completion: { type: "confirm" }, next: "chat-end", requires: "companion" },
    { id: "chat-end", kind: "story", dialogue: ["能说出口的话，就已经有了去处。"], instruction: "这条支线先到这里。", completion: { type: "confirm" }, next: null }
  ]
});

export const memoryCourse = course({
  id: "memory", title: "记住与改正", chapterTitle: "记忆 · 留痕", contentVersion: 1,
  prerequisite: "前提：至少创建一位人物。没有候选记忆也可以只了解。",
  fallbackCopy: "还没有人物，也就没有记忆。先创建一位，再回来。",
  steps: [
    { id: "memory-open", kind: "navigate", target: "open-memory", dialogue: ["有些话，你也许希望往后还被记得。"], instruction: "点击「记忆」，查看候选与长期记忆。", completion: { type: "confirm" }, next: "memory-kinds", requires: "companion" },
    { id: "memory-kinds", kind: "read", target: "memory-list", dialogue: ["候选是还没确认的说法，长期记忆是已经生效的。"], instruction: "认识「候选」和「生效中」的区别。", completion: { type: "confirm" }, next: "memory-source", requires: "companion" },
    { id: "memory-source", kind: "read", target: "memory-list", dialogue: ["每一条都能追问它是从哪句话来的。"], instruction: "看一眼记忆的来源与时间。", completion: { type: "confirm" }, next: "memory-confirm", requires: "companion" },
    { id: "memory-confirm", kind: "action", target: "memory-list", dialogue: ["确认之前，它不会影响 TA 的说法。"], instruction: "如果有候选，点击「确认」；没有候选就点「知道了」继续。", completion: { type: "confirm" }, next: "memory-history", requires: "companion" },
    { id: "memory-history", kind: "read", target: "memory-list", policy: "free", dialogue: ["改过的记忆会留下历史，旧事实不会凭空消失。"], instruction: "认识「记忆变更历史」与替代说明。", completion: { type: "confirm" }, next: "memory-forget", requires: "companion" },
    { id: "memory-forget", kind: "read", target: "memory-list", dialogue: ["遗忘只让它不再被想起，不会删掉原始聊天。"], instruction: "认识归档与遗忘，不必真的执行。", completion: { type: "confirm" }, next: "memory-end", requires: "companion" },
    { id: "memory-end", kind: "story", dialogue: ["记得与忘记，都该由你说了算。"], instruction: "这条支线先到这里。", completion: { type: "confirm" }, next: null }
  ]
});

export const materialImportCourse = course({
  id: "material-import", title: "导入素材", chapterTitle: "素材 · 补全", contentVersion: 1,
  prerequisite: "前提：至少创建一位人物。导入会真实写入资料，需要你主动提交。",
  fallbackCopy: "还没有可以导入素材的人物。先创建一位。",
  steps: [
    { id: "import-open", kind: "navigate", target: "open-import", dialogue: ["有些细节，可以从你手边的材料里补上。"], instruction: "点击「导入素材」。", completion: { type: "confirm" }, next: "import-kind", requires: "companion" },
    { id: "import-kind", kind: "read", target: "import-form", dialogue: ["贴一段文字，或选一个文件。"], instruction: "认识导入方式与素材类型。", completion: { type: "confirm" }, next: "import-input", requires: "companion" },
    { id: "import-input", kind: "input", target: "import-form", dialogue: ["示例只是示例，用不用由你决定。"], instruction: "输入内容，或主动采用示例文本。", completion: { type: "confirm" }, next: "import-submit", requires: "companion" },
    { id: "import-submit", kind: "action", target: "import-submit", dialogue: ["这一步会真的写入 TA 的资料。"], instruction: "核对后点击提交。取消不会写入任何东西。", completion: { type: "evidence", kind: "companion-updated" }, next: "import-end", requires: "companion" },
    { id: "import-end", kind: "story", dialogue: ["补全的细节，会慢慢长进 TA 的话里。"], instruction: "这条支线先到这里。", completion: { type: "confirm" }, next: null }
  ]
});

export const chatCharacterCourse = course({
  id: "chat-character", title: "从聊天记录创建", chapterTitle: "记录 · 提炼", contentVersion: 1,
  prerequisite: "前提：一份你自己的聊天记录文本；没有时可用虚构样例。",
  fallbackCopy: "没有聊天记录也可以先用虚构样例体验；样例不会上传。",
  steps: [
    { id: "cc-open", kind: "navigate", target: "open-chat-import", dialogue: ["过去的对话里，藏着一个人的语气。"], instruction: "点击「从聊天记录创建」。", completion: { type: "confirm" }, next: "cc-source", requires: "none" },
    { id: "cc-source", kind: "input", target: "cc-form", dialogue: ["先选一份记录，或使用虚构样例。"], instruction: "选择记录来源；样例会明确标出是虚构的。", completion: { type: "confirm" }, next: "cc-samples", requires: "none" },
    { id: "cc-samples", kind: "input", target: "cc-form", dialogue: ["只把你选中、属于 TA 的句子送去提炼。"], instruction: "选择双方样本，避开你自己的私人内容。", completion: { type: "confirm" }, next: "cc-preview", requires: "none" },
    { id: "cc-preview", kind: "review", target: "cc-form", dialogue: ["提炼出来的只是草稿，你可以逐条改。"], instruction: "核对预览内容，必要时修改。", completion: { type: "confirm" }, next: "cc-submit", requires: "none" },
    { id: "cc-submit", kind: "action", target: "cc-submit", dialogue: ["确认之后才会真的创建人物。"], instruction: "点击确认创建。取消不会写入。", completion: { type: "evidence", kind: "companion-created" }, next: "cc-end", requires: "none" },
    { id: "cc-end", kind: "story", dialogue: ["语气比名字更难伪造。慢慢来。"], instruction: "这条支线先到这里。", completion: { type: "confirm" }, next: null }
  ]
});

export const dreamCourse = course({
  id: "dream", title: "入梦练习", chapterTitle: "入梦 · 校准", contentVersion: 1,
  prerequisite: "前提：至少创建一位人物；已有梦境草稿可以接着练。",
  fallbackCopy: "还没有可以入梦的人物。先创建一位，再回来。",
  steps: [
    { id: "dream-open", kind: "navigate", target: "open-dream", dialogue: ["梦里的练习不会写进正式聊天。"], instruction: "点击「入梦」。", completion: { type: "confirm" }, next: "dream-start", requires: "companion" },
    { id: "dream-start", kind: "action", target: "dream-start", dialogue: ["先选对比选择，还是自由试聊。"], instruction: "点击「进入梦境」。", completion: { type: "evidence", kind: "dream-started" }, next: "dream-situation", requires: "companion" },
    { id: "dream-situation", kind: "input", target: "dream-situation", dialogue: ["说一句你想听 TA 回应的话。"], instruction: "填写梦中情境。", completion: { type: "confirm" }, next: "dream-generate", requires: "companion" },
    { id: "dream-generate", kind: "action", target: "dream-generate", dialogue: ["看看 TA 会怎么接。"], instruction: "点击「听听回响」。", completion: { type: "evidence", kind: "dream-generated" }, next: "dream-fragments", requires: "companion" },
    { id: "dream-fragments", kind: "review", target: "dream-fragments", dialogue: ["像的话语会被拾起来，变成草稿里的片段。"], instruction: "核对片段，勾选你愿意留下的。没有合适的就不勾。", completion: { type: "confirm" }, next: "dream-review", requires: "companion" },
    { id: "dream-review", kind: "action", target: "dream-review", dialogue: ["应用之前，先看看会改哪些地方。"], instruction: "点击「结束入梦」，打开变化预览。", completion: { type: "confirm" }, next: "dream-apply", requires: "companion" },
    { id: "dream-apply", kind: "action", target: "dream-apply-confirm", dialogue: ["确认应用，TA 的正式设定才会变。"], instruction: "确认应用，或取消并保留草稿。取消不影响正式人物。", completion: { type: "evidence", kind: "dream-applied" }, next: "dream-history", requires: "companion" },
    { id: "dream-history", kind: "read", target: "dream-history", policy: "free", dialogue: ["每一次醒来都会留下一个版本。"], instruction: "认识版本历史与恢复入口，不必真的恢复。", completion: { type: "confirm" }, next: "dream-end", requires: "companion" },
    { id: "dream-end", kind: "story", dialogue: ["梦里的练习，只在你愿意时才留下。"], instruction: "这条支线先到这里。", completion: { type: "confirm" }, next: null }
  ]
});

export const groupsCourse = course({
  id: "groups", title: "围坐群聊", chapterTitle: "群聊 · 同席", contentVersion: 1,
  prerequisite: "前提：至少有一位可邀请的人物；已有群聊可直接复习。",
  fallbackCopy: "还没有可邀请的人物。先创建一位，再来围坐。",
  steps: [
    { id: "groups-open", kind: "navigate", target: "open-groups", dialogue: ["灯下可以坐不止两个人。"], instruction: "点击「围坐 · 群聊」。", completion: { type: "confirm" }, next: "groups-create", requires: "none" },
    { id: "groups-create", kind: "navigate", target: "group-create", dialogue: ["已经有群就先选一个；没有就新建。"], instruction: "点击列表里的群，或「创建群聊」。", completion: { type: "confirm" }, next: "groups-members", requires: "companion" },
    { id: "groups-members", kind: "read", target: "group-settings", dialogue: ["“允许主动发言”和“允许使用私聊记忆”是两件事。"], instruction: "认识成员开关，按你的意思设置。", completion: { type: "confirm" }, next: "groups-send", requires: "group" },
    { id: "groups-send", kind: "action", target: "group-send", dialogue: ["说点什么，让灯下热闹起来。"], instruction: "在群聊输入框写一句话，然后点击「发送」。", completion: { type: "evidence", kind: "group-message-sent" }, next: "groups-mention", requires: "group" },
    { id: "groups-mention", kind: "read", target: "group-mention", dialogue: ["想请谁接话，就 @ 谁。"], instruction: "认识「＠ 选择成员」。", completion: { type: "confirm" }, next: "groups-invite", requires: "group" },
    { id: "groups-invite", kind: "read", target: "group-invite", dialogue: ["主动发言也可以由你亲手邀请。"], instruction: "认识「邀请主动发言」。", completion: { type: "confirm" }, next: "groups-end", requires: "group" },
    { id: "groups-end", kind: "story", dialogue: ["一盏灯，一张桌。人齐了，话就有了去处。"], instruction: "这条支线先到这里。", completion: { type: "confirm" }, next: null }
  ]
});

export const groupMemoryCourse = course({
  id: "group-memory", title: "共同的记忆", chapterTitle: "群记忆 · 知情", contentVersion: 1,
  prerequisite: "前提：自己的群聊，和至少一条已保存消息。",
  fallbackCopy: "还没有可用的群聊消息。可以先回群里发一句。",
  steps: [
    { id: "gm-select", kind: "action", target: "group-log", dialogue: ["共同记得的事，先从一条消息开始。"], instruction: "在消息旁勾选「选作群记忆」。", completion: { type: "confirm" }, next: "gm-panel", requires: "group" },
    { id: "gm-panel", kind: "read", target: "group-memory-panel", dialogue: ["来源就是你选的这几句话。"], instruction: "认识群记忆面板里的来源消息。", completion: { type: "confirm" }, next: "gm-known", requires: "group" },
    { id: "gm-known", kind: "input", target: "group-memory-panel", dialogue: ["哪些成员知情，由你指定。"], instruction: "指定知情成员。不会扩大私聊授权。", completion: { type: "confirm" }, next: "gm-submit", requires: "group" },
    { id: "gm-submit", kind: "action", target: "group-memory-submit", dialogue: ["核对之后再确认。"], instruction: "核对内容并点击「确认群记忆」。", completion: { type: "evidence", kind: "memory-confirmed" }, next: "gm-end", requires: "group" },
    { id: "gm-end", kind: "story", dialogue: ["共同的记忆，也要共同的同意。"], instruction: "这条支线先到这里。", completion: { type: "confirm" }, next: null }
  ]
});

export const voiceCourse = course({
  id: "voice", title: "语音输入与朗读", chapterTitle: "声音 · 边界", contentVersion: 1,
  prerequisite: "前提：取决于设备、权限和语音引擎；不支持时只了解说明。",
  fallbackCopy: "这里暂时无法使用语音。文字聊天不受影响。",
  steps: [
    { id: "voice-open", kind: "read", target: "chat-tools", dialogue: ["说话比打字快，但会用到话筒和网络。"], instruction: "先认识人物工具栏里的语音入口。", completion: { type: "confirm" }, next: "voice-path", requires: "companion" },
    { id: "voice-path", kind: "read", target: "settings-provider", dialogue: ["系统识别把声音交给设备，供应商识别会上传录音。"], instruction: "在设置里了解两条路径的区别。", completion: { type: "confirm" }, next: "voice-authorize", requires: "none" },
    { id: "voice-authorize", kind: "action", target: "voice-input", dialogue: ["授权必须由你亲手点。"], instruction: "点击「语音输入」，系统询问时再决定是否允许。", completion: { type: "confirm" }, next: "voice-draft", requires: "companion" },
    { id: "voice-draft", kind: "input", target: "chat-input", dialogue: ["转写会进入草稿，不替你发送。"], instruction: "核对转写草稿，觉得可以再自己点发送。", completion: { type: "confirm" }, next: "voice-read", requires: "companion" },
    { id: "voice-read", kind: "action", target: "voice-read", dialogue: ["想听 TA 说话时，可以朗读最近一条回复。"], instruction: "点击「播放最近回复」，随时可以停止。", completion: { type: "confirm" }, next: "voice-end", requires: "companion" },
    { id: "voice-end", kind: "story", dialogue: ["声音也是边界，交给你自己决定。"], instruction: "这条支线先到这里。", completion: { type: "confirm" }, next: null }
  ]
});

export const proactiveCourse = course({
  id: "proactive", title: "主动回响", chapterTitle: "回响 · 主动", contentVersion: 1,
  prerequisite: "前提：保留当前设置也算完成了解。",
  fallbackCopy: "暂时读不到主动回响设置。可以先回到聊天。",
  steps: [
    { id: "proactive-global", kind: "read", target: "settings-preferences", dialogue: ["全局开关决定你要不要收到主动消息。"], instruction: "在设置里找到「接受主动消息」。", completion: { type: "confirm" }, next: "proactive-person", requires: "none" },
    { id: "proactive-person", kind: "read", target: "person-proactive", dialogue: ["每个人物还可以单独开关。"], instruction: "认识人物表单里的「主动回响」。", completion: { type: "confirm" }, next: "proactive-frequency", requires: "companion" },
    { id: "proactive-frequency", kind: "read", target: "person-proactive", dialogue: ["太快会打扰，太慢会像没人在。"], instruction: "认识预设与自定义频率。", completion: { type: "confirm" }, next: "proactive-save", requires: "companion" },
    { id: "proactive-save", kind: "action", target: "settings-save", dialogue: ["改了就保存；不打算改也可以保留原值。"], instruction: "点击「保存」，或保留当前值直接结束。", completion: { type: "evidence", kind: "settings-saved" }, next: "proactive-end", requires: "none" },
    { id: "proactive-end", kind: "story", dialogue: ["是否被打扰，应该由你说最后一句话。"], instruction: "这条支线先到这里。", completion: { type: "confirm" }, next: null }
  ]
});

export const modelCourse = course({
  id: "model", title: "模型连接", chapterTitle: "模型 · 连接", contentVersion: 1,
  prerequisite: "前提：未配置时可只了解字段用途；已有 Key 不必重填。",
  fallbackCopy: "暂时读不到连接配置。可以稍后再试。",
  steps: [
    { id: "model-open", kind: "navigate", target: "settings-provider", dialogue: ["模型是这座城说话的嗓子。"], instruction: "打开设置的「模型供应商」。", completion: { type: "confirm" }, next: "model-fields", requires: "none" },
    { id: "model-fields", kind: "read", target: "settings-provider", dialogue: ["网关、Key、模型，各有用处。"], instruction: "认识字段用途。页面不会展示完整 Key，教程也不保存它。", completion: { type: "confirm" }, next: "model-configure", requires: "none" },
    { id: "model-configure", kind: "input", target: "settings-model", dialogue: ["已经配好就直接测试。"], instruction: "填写或沿用已有配置。", completion: { type: "confirm" }, next: "model-test", requires: "none" },
    { id: "model-test", kind: "action", target: "settings-model-test", dialogue: ["测试通过只说明文字模型能连上。"], instruction: "点击「测试连接」。", completion: { type: "confirm" }, next: "model-end", requires: "none" },
    { id: "model-end", kind: "story", dialogue: ["能连上，才好说话。"], instruction: "这条支线先到这里，可以回到主线。", completion: { type: "confirm" }, next: null }
  ]
});

export const preferencesCourse = course({
  id: "preferences", title: "称呼与偏好", chapterTitle: "偏好 · 你", contentVersion: 1,
  prerequisite: "前提：保留当前值也算已完成。",
  fallbackCopy: "暂时读不到设置，稍后再试。",
  steps: [
    { id: "preferences-profile", kind: "read", target: "settings-profile", dialogue: ["昵称、时区、语言，会跟着你走。"], instruction: "看一眼基础资料。", completion: { type: "confirm" }, next: "preferences-comm", requires: "none" },
    { id: "preferences-comm", kind: "read", target: "settings-preferences", dialogue: ["沟通偏好决定 TA 说话的分寸。"], instruction: "看一眼沟通偏好。", completion: { type: "confirm" }, next: "preferences-appearance", requires: "none" },
    { id: "preferences-appearance", kind: "read", target: "settings-appearance", dialogue: ["外观只是外壳，钟声可以再听一次。"], instruction: "看一眼外观分区。", completion: { type: "confirm" }, next: "preferences-save", requires: "none" },
    { id: "preferences-save", kind: "action", target: "settings-save", dialogue: ["改动由你保存。"], instruction: "点击「保存」，或保留当前值结束。", completion: { type: "evidence", kind: "settings-saved" }, next: "preferences-end", requires: "none" },
    { id: "preferences-end", kind: "story", dialogue: ["这座城，也照着你的样子长。"], instruction: "这条支线先到这里。", completion: { type: "confirm" }, next: null }
  ]
});

export const accountDataCourse = course({
  id: "account-data", title: "数据与账号", chapterTitle: "账号 · 边界", contentVersion: 1,
  prerequisite: "前提：删除账号只讲解，不引导实操。",
  fallbackCopy: "暂时读不到账号信息，稍后再试。",
  steps: [
    { id: "account-open", kind: "navigate", target: "settings-privacy", dialogue: ["你的数据，首先是你自己的。"], instruction: "打开「数据与隐私」。", completion: { type: "confirm" }, next: "account-export", requires: "none" },
    { id: "account-export", kind: "action", target: "settings-privacy", dialogue: ["导出包含关系、消息、记忆与脱敏记录。"], instruction: "想导出就点击「导出数据」；不想也可以跳过。", completion: { type: "confirm" }, next: "account-local", requires: "none" },
    { id: "account-local", kind: "read", target: "settings-privacy", dialogue: ["本地客户端的数据各设备独立，不走自动同步。"], instruction: "了解本地恢复与设备独立。", completion: { type: "confirm" }, next: "account-delete", requires: "none" },
    { id: "account-delete", kind: "read", target: "settings-privacy", dialogue: ["删除账号不可撤销。这里只讲，不让你误触。"], instruction: "读一遍风险说明即可，不必执行。", completion: { type: "confirm" }, next: "account-end", requires: "none" },
    { id: "account-end", kind: "story", dialogue: ["把边界看清楚，才走得久。"], instruction: "这条支线先到这里。", completion: { type: "confirm" }, next: null }
  ]
});
