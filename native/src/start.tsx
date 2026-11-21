import { createRoot } from "react-dom/client";
import { App } from "./ui/app";
import { openLocalDatabase } from "./runtime/account";
import { installLocalApi } from "./runtime/api";
import { installNativeDownloads } from "./runtime/files";
import "../../src/app/globals.css";
import "./ui/local.css";
export async function start() {
  try {
    await openLocalDatabase();
    installLocalApi();
    installNativeDownloads();
    createRoot(document.getElementById("root")!).render(<App />);
  } catch {
    document.getElementById("root")!.textContent = "本地数据未能打开。请保留现有数据和备份，使用兼容版本重试；不要删除应用数据。";
  }
}
