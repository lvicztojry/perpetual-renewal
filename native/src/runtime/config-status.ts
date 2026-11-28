import { getLlmCredentialStatus } from "@/lib/credentials";
export async function getConfigReadinessSnapshot(userId: string) {
  const credential = await getLlmCredentialStatus(userId);
  const items = [
    { id: "database", label: "本机加密数据库", status: "ready", description: "数据保存在此设备，不依赖运行中的电脑或应用服务器。", nextStep: "更新前保留备份，勿卸载后再安装。" },
    { id: "llm_key", label: "个人测试 Key", status: credential.configured ? "ready" : "missing", description: "请填写分配给你的限额 Key。", nextStep: "在当前设置页保存服务地址、Key 和模型，再测试连接。" }
  ];
  return { checkedAt: new Date().toISOString(), summary: { readyCount: credential.configured ? 2 : 1, missingCount: credential.configured ? 0 : 1, warningCount: 0, productionReady: false }, items };
}
