export class GroupError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export const invalid = () => new GroupError(400, "群聊参数无效或超过长度限制。");
export const missing = () => new GroupError(404, "未找到群聊或人物。");
export const conflict = () => new GroupError(409, "群聊已更新或该回复已处理，请刷新后重试。");
export const capacity = () => new GroupError(409, "群聊容量已满，请先导出或清理记忆；已有消息及记忆来源不会自动删除。");
export const modelFailure = () => new GroupError(502, "群聊回复未完成，可重试；每位成员每轮最多尝试 3 次，达到上限后停止调用模型。");
