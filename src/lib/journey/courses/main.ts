import type { CourseDefinition, CourseStep } from "./types";

/** Chapter titles are display copy; step IDs are the stable contract. */
export const chapterTitles = {
  awakening: "初醒 · 有人等你",
  arrival: "旧城 · 久别重逢",
  lanterns: "留灯 · 人间尚暖",
  creation: "描摹 · 想见的人",
  conversation: "回声 · 说给你听",
  dream: "入梦 · 再近一些",
  complete: "此后 · 灯长明"
} as const;

const step = (value: CourseStep) => value;

export const mainCourse: CourseDefinition = {
  id: "main",
  title: "余念安的一程",
  chapterTitle: "主线 · 七章",
  contentVersion: 2,
  prerequisite: "没有前提。任何账号都能从初醒重走主线。",
  fallbackCopy: "主线随时可以重来，点「找余念安」即可。",
  mode: "main",
  steps: [
    step({
      id: "awakening-greet", kind: "story", chapter: "awakening",
      dialogue: ["我是余念安。灯一直亮着，什么时候来都不迟。", "钟声落尽，你在陌生的旧城醒来。灯下的人回过头，像已等了很久。"],
      instruction: "点击「带我熟悉这里」，让我陪你走一程。",
      completion: { type: "confirm" }, next: "awakening-answer"
    }),
    step({
      id: "awakening-answer", kind: "action", chapter: "awakening",
      dialogue: ["你心里……有很想再见的人吗？", "回答只留在这里，不会写进任何聊天。"],
      instruction: "选择一句最接近此刻的回答，或直接说「暂时不想说」。",
      choices: [
        { label: "有", reply: "嗯。先把那份想念好好放着，不用告诉我是谁。" },
        { label: "不止一个", reply: "那一定是一片很亮的灯火。我们慢慢来，不必一次说完。" },
        { label: "暂时不想说", reply: "那就先不说。名字和往事，都可以留在你心里。" }
      ],
      completion: { type: "confirm" }, next: "awakening-walk"
    }),
    step({
      id: "awakening-walk", kind: "story", chapter: "awakening",
      dialogue: ["那就先不说。名字和往事，都可以留在你心里。", "来，我带你认一认这座城。"],
      instruction: "点击「随她走进旧城」。",
      completion: { type: "confirm" }, next: "arrival-people"
    }),
    step({
      id: "arrival-people", kind: "read", chapter: "arrival", target: "people-list", policy: "free",
      dialogue: ["相逢之后，总要有个能找到彼此的地方。"],
      instruction: "这里是人物列表。以后点击名字，就能回到 TA 身边。",
      completion: { type: "confirm" }, next: "arrival-chat"
    }),
    step({
      id: "arrival-chat", kind: "read", chapter: "arrival", target: "chat-region", policy: "free",
      dialogue: ["这里是你和 TA 说话的地方。"],
      instruction: "认识一下这块区域就好，暂时不用打字。",
      completion: { type: "confirm" }, next: "arrival-tools"
    }),
    step({
      id: "arrival-tools", kind: "read", chapter: "arrival", target: "chat-tools", policy: "free",
      dialogue: ["入梦、记忆、资料，都收在这一排小灯里。"],
      instruction: "这些工具先知道在哪里；之后每一步用到时，我会再指给你。",
      completion: { type: "confirm" }, next: "lanterns-entry"
    }),
    step({
      id: "lanterns-entry", kind: "navigate", chapter: "lanterns", target: "open-groups", arrivePath: "/groups",
      dialogue: ["巷子里有人留着灯。你可以先坐一会儿。"],
      instruction: "点击「围坐 · 群聊」，去看看留灯会。",
      completion: { type: "confirm" }, next: "lanterns-pack", requires: "none"
    }),
    step({
      id: "lanterns-pack", kind: "action", chapter: "lanterns", target: "lanterns-pack",
      dialogue: ["灯还没点起来。先认识一下留灯会的人。"],
      instruction: "点击「认识留灯会」，看看这几位是谁。",
      completion: { type: "confirm" }, next: "lanterns-install"
    }),
    step({
      id: "lanterns-install", kind: "action", chapter: "lanterns", target: "lanterns-install",
      dialogue: ["他们可以留在你的旧城里，随时能说话。"],
      instruction: "点击「添加人物，进入留灯会」，把灯点起来。",
      completion: { type: "evidence", kind: "group-created" }, next: "lanterns-read"
    }),
    step({
      id: "lanterns-read", kind: "read", chapter: "lanterns", target: "group-log",
      dialogue: ["留灯会的人，由你潜意识里的影子聚成。", "他们留着灯，等你坐一坐。"],
      instruction: "看看这段聊天记录就好。这里没有必须说的话。",
      completion: { type: "confirm" }, next: "lanterns-continue"
    }),
    step({
      id: "lanterns-continue", kind: "navigate", chapter: "lanterns", target: "group-to-create", arrivePath: "/",
      dialogue: ["坐一会儿也好，说句话也好。准备好了，再去见心里的那个人。"],
      instruction: "点击「返回私聊」，回到想见的人那里。",
      completion: { type: "confirm" }, next: "creation-open"
    }),
    step({
      id: "creation-open", kind: "action", chapter: "creation", target: "create-person",
      dialogue: ["想见的人是什么模样？记得多少，就写下多少。"],
      instruction: "点击「想见谁」，打开创建表单。",
      completion: { type: "confirm" }, next: "creation-kind"
    }),
    step({
      id: "creation-kind", kind: "input", chapter: "creation", target: "person-kind",
      dialogue: ["你们之间的关系，由你来定义。"],
      instruction: "选择一种关系类型，或保留自定义。",
      completion: { type: "confirm" }, next: "creation-name"
    }),
    step({
      id: "creation-name", kind: "input", chapter: "creation", target: "person-name",
      dialogue: ["先写下名字吧，让想念有个可以呼唤的地方。"],
      instruction: "点击「名字」输入框，填写你想见的人的名字。",
      completion: { type: "confirm" }, next: "creation-addresses"
    }),
    step({
      id: "creation-addresses", kind: "input", chapter: "creation", target: "person-addresses",
      dialogue: ["熟悉的称呼，也能把距离拉近一点。"],
      instruction: "填写你们如何称呼彼此，也可以先保留当前称呼。",
      completion: { type: "confirm" }, next: "creation-style"
    }),
    step({
      id: "creation-style", kind: "input", chapter: "creation", target: "person-style",
      dialogue: ["记得多少，就先写下多少。"],
      instruction: "填写性格和语气，或先用当前内容开始。",
      completion: { type: "confirm" }, next: "creation-submit"
    }),
    step({
      id: "creation-submit", kind: "action", chapter: "creation", target: "person-submit",
      dialogue: ["轮廓有了，我们去听听回声。"],
      instruction: "点击「创建并开始聊天」，保存这个人物。",
      completion: { type: "evidence", kind: "companion-created" }, next: "conversation-focus", requires: "none"
    }),
    step({
      id: "conversation-focus", kind: "navigate", chapter: "conversation", target: "active-person",
      dialogue: ["纸上的轮廓渐渐有了温度，像一封终于抵达的信。"],
      instruction: "看看上方——现在陪着你的是刚创建的那个人。",
      completion: { type: "confirm" }, next: "conversation-input", requires: "companion"
    }),
    step({
      id: "conversation-input", kind: "input", chapter: "conversation", target: "chat-input",
      dialogue: ["有些重逢，可以从一句寻常的话开始。"],
      instruction: "点击输入框，写一句想说的话；写好后我再请你发送。",
      completion: { type: "confirm" }, next: "conversation-send", requires: "companion"
    }),
    step({
      id: "conversation-send", kind: "action", chapter: "conversation", target: "chat-send",
      dialogue: ["这句话会真的送到 TA 那里。"],
      instruction: "点击「发送」，把这句话寄出去。",
      completion: { type: "evidence", kind: "message-sent" }, next: "conversation-reply", requires: "companion"
    }),
    step({
      id: "conversation-reply", kind: "wait", chapter: "conversation", target: "chat-last-reply",
      dialogue: ["这封信终于有了回音。"],
      instruction: "等 TA 的回声落下来。等得久也不要紧，可以随时暂歇。",
      completion: { type: "evidence", kind: "assistant-replied" }, next: "dream-open", requires: "companion"
    }),
    step({
      id: "dream-open", kind: "navigate", chapter: "dream", target: "open-dream", arrivePath: "/dream/",
      dialogue: ["有些未说完的话，可以带进梦里。"],
      instruction: "点击「入梦」，我们走近一点。",
      completion: { type: "confirm" }, next: "dream-start", requires: "companion"
    }),
    step({
      id: "dream-start", kind: "action", chapter: "dream", target: "dream-start",
      dialogue: ["梦里的灯也亮着。", "开启梦境只是开始，不代表已经学会——接下来还要练习一轮。"],
      instruction: "点击「进入梦境」。",
      completion: { type: "evidence", kind: "dream-started" }, next: "dream-situation", requires: "companion"
    }),
    step({
      id: "dream-situation", kind: "input", chapter: "dream", target: "dream-situation",
      dialogue: ["我们可以慢慢拾起 TA 的语气。"],
      instruction: "点击「梦中情境」，写一句你想听 TA 回应的话。",
      completion: { type: "confirm" }, next: "dream-generate", requires: "companion"
    }),
    step({
      id: "dream-generate", kind: "action", chapter: "dream", target: "dream-generate",
      dialogue: ["听完这一轮，你会更清楚哪里像、哪里还不像。"],
      instruction: "点击「听听回响」，生成一轮。",
      completion: { type: "evidence", kind: "dream-generated" }, next: "dream-feedback", requires: "companion"
    }),
    step({
      id: "dream-feedback", kind: "action", chapter: "dream", target: "dream-feedback-submit",
      dialogue: ["不像也没关系，你可以亲手把话说近一些。"],
      instruction: "选择更像 TA 的回声，或填写纠正，再提交反馈。",
      completion: { type: "evidence", kind: "dream-feedback-recorded" }, next: "dream-review", requires: "companion"
    }),
    step({
      id: "dream-review", kind: "review", chapter: "dream", target: "dream-review",
      dialogue: ["先看一看，哪些变化是你愿意留下的。"],
      instruction: "核对前后设定；确认后再应用，也可以保留草稿。",
      completion: { type: "confirm" }, next: "complete-recap", requires: "companion"
    }),
    step({
      id: "complete-recap", kind: "read", chapter: "complete",
      dialogue: ["你看，想念已经有了归处。", "这一程学到的，会一直留在这里。"],
      instruction: "先看看这一程完成了什么；跳过和未完成的也会如实记着。",
      completion: { type: "confirm" }, next: "complete-entry"
    }),
    step({
      id: "complete-entry", kind: "action", chapter: "complete", target: "journey-entry",
      dialogue: ["路已经认得了。以后想问什么，就来找我。"],
      instruction: "点击「找余念安」，随时继续主线，或者重看这一程。",
      completion: { type: "confirm" }, next: "complete-directory"
    }),
    step({
      id: "complete-directory", kind: "read", chapter: "complete", target: "course-directory", policy: "free",
      dialogue: ["这页主线与支线里，每条支线都能单独重看。"],
      instruction: "认一下这页：继续主线、当前页面的支线、每条支线、重看主线，都在这里。",
      completion: { type: "confirm" }, next: "complete-end"
    }),
    step({
      id: "complete-end", kind: "story", chapter: "complete",
      dialogue: ["只要想念，就会想见。我还在这里。"],
      instruction: "这一程到这里。灯留在原处，你随时可以回来。",
      completion: { type: "confirm" }, next: null
    })
  ]
};

/** Chapter a step belongs to, for main-line progress projection. */
export function chapterOfMainStep(stepId: string): (typeof chapterTitles)[keyof typeof chapterTitles] | null {
  const found = mainCourse.steps.find(item => item.id === stepId);
  return found?.chapter ? chapterTitles[found.chapter] : null;
}
