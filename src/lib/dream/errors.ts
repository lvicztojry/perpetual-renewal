export class DreamError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export const conflict = () => new DreamError(409, "梦境或人物资料已更新，请刷新后重试。");
export const missing = () => new DreamError(404, "未找到人物或梦境。");
export const invalid = () => new DreamError(400, "梦境参数无效或超过长度限制。");
export const modelFailure = () => new DreamError(502, "模型暂时无法完成，请检查连接后重试。原有资料尚未改动。");
