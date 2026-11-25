//! 安卓语音识别插件。
//!
//! WebView 不实现 Web Speech API 的 SpeechRecognition，安卓上只能调用系统的
//! SpeechRecognizer。Kotlin 实现在 `native/android/SpeechPlugin.kt`，由
//! `native/scripts/prepare-mobile.mjs` 复制进生成的 Android 工程。
//!
//! 线程模型：SpeechRecognizer 的结果回调必须投递到主线程，而
//! `run_mobile_plugin` 会阻塞等待该结果。Tauri 的同步命令跑在主线程，会与
//! 回调互相等待而死锁；因此这些命令一律声明为 `async`——Tauri 把异步命令
//! 放到后台线程执行，阻塞等待是安全的。
//!
//! 插件固定使用 `Wry` 运行时：`register_android_plugin` 返回
//! `PluginHandle<R>`，而命令无法对运行时泛型化，因此这里不走 `R: Runtime`。

// 非 Android 构建用不到这些字段，避免 dead_code 噪音。
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{command, Manager, State, Wry};

const PLUGIN_NAME: &str = "renewal-speech";

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.perpetualrenewal.localtest";

const FALLBACK_MESSAGE: &str = "这段语音没有识别出来，可以再录一次，或改用文字。";

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecognizeOptions {
    #[serde(default)]
    pub lang: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecognizeOutcome {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_type: Option<String>,
}

impl RecognizeOutcome {
    fn text(value: String) -> Self {
        Self { ok: true, text: Some(value), error: None, error_type: None }
    }

    fn failure(error: impl Into<String>, error_type: &str) -> Self {
        Self {
            ok: false,
            text: None,
            error: Some(error.into()),
            error_type: Some(error_type.into()),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Availability {
    pub available: bool,
}

/// 平台后端：Android 走 Kotlin；其它平台恒为不可用，让前端回退到浏览器识别。
#[cfg(target_os = "android")]
pub struct SpeechBackend {
    handle: tauri::plugin::PluginHandle<Wry>,
}

#[cfg(target_os = "android")]
impl SpeechBackend {
    fn new(handle: tauri::plugin::PluginHandle<Wry>) -> Self {
        Self { handle }
    }

    fn recognize(&self, options: &RecognizeOptions) -> RecognizeOutcome {
        #[derive(Deserialize)]
        struct TextResponse {
            text: String,
        }

        let payload = serde_json::json!({
            "lang": options.lang.clone().unwrap_or_else(|| "zh-CN".into())
        });

        match self.handle.run_mobile_plugin::<TextResponse>("recognize", payload) {
            Ok(response) if !response.text.trim().is_empty() => {
                RecognizeOutcome::text(response.text)
            }
            // Kotlin 侧没有文字时也回一个空串，这里统一当作没听清。
            Ok(_) => RecognizeOutcome::failure(
                "没有听到声音，可以再说一次，或改用文字输入。",
                "no-speech",
            ),
            Err(error) => classify_error(&error.to_string()),
        }
    }

    fn is_available(&self) -> bool {
        #[derive(Deserialize)]
        struct AvailableResponse {
            available: bool,
        }

        self.handle
            .run_mobile_plugin::<AvailableResponse>("isAvailable", serde_json::json!({}))
            .map(|response| response.available)
            .unwrap_or(false)
    }

    fn cancel(&self) {
        // 取消失败无所谓：下一次 recognize 会丢弃旧会话。
        let _ = self
            .handle
            .run_mobile_plugin::<serde_json::Value>("cancel", serde_json::json!({}));
    }
}

#[cfg(not(target_os = "android"))]
pub struct SpeechBackend;

#[cfg(not(target_os = "android"))]
impl SpeechBackend {
    fn recognize(&self, _options: &RecognizeOptions) -> RecognizeOutcome {
        RecognizeOutcome::failure("当前平台不支持设备语音识别。", "unavailable")
    }

    fn is_available(&self) -> bool {
        false
    }

    fn cancel(&self) {}
}

/// Kotlin 侧的拒绝消息形如 `[code] - 文案`，这里还原成稳定的 errorType。
#[cfg(target_os = "android")]
fn classify_error(message: &str) -> RecognizeOutcome {
    let text = message.trim();
    let lower = text.to_lowercase();

    let error_type = if lower.contains("cancelled") || lower.contains("superseded") {
        "cancelled"
    } else if lower.contains("not-allowed") {
        "not-allowed"
    } else if lower.contains("no-speech") {
        "no-speech"
    } else if lower.contains("network") {
        "network"
    } else if lower.contains("unavailable") {
        "unavailable"
    } else if lower.contains("busy") {
        "busy"
    } else {
        "unknown"
    };

    // 拒绝消息可能带 `[code] - ` 前缀，只把文案给用户看。
    let readable = text.rsplit(" - ").next().unwrap_or(text).trim();
    let readable = if readable.is_empty() { FALLBACK_MESSAGE } else { readable };

    RecognizeOutcome::failure(readable, error_type)
}

#[command]
async fn speech_is_available(backend: State<'_, SpeechBackend>) -> Result<Availability, String> {
    Ok(Availability { available: backend.is_available() })
}

#[command]
async fn speech_recognize(
    backend: State<'_, SpeechBackend>,
    options: Option<RecognizeOptions>,
) -> Result<RecognizeOutcome, String> {
    Ok(backend.recognize(&options.unwrap_or_default()))
}

#[command]
async fn speech_cancel(backend: State<'_, SpeechBackend>) -> Result<(), String> {
    backend.cancel();
    Ok(())
}

/// 注册语音识别插件。非 Android 平台命令依然存在但报告「不可用」，
/// 前端据此回退到浏览器识别。
pub fn init() -> TauriPlugin<Wry> {
    Builder::<Wry>::new(PLUGIN_NAME)
        .invoke_handler(tauri::generate_handler![
            speech_is_available,
            speech_recognize,
            speech_cancel
        ])
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            let backend =
                SpeechBackend::new(api.register_android_plugin(PLUGIN_IDENTIFIER, "SpeechPlugin")?);

            #[cfg(not(target_os = "android"))]
            let backend = {
                let _ = &api;
                SpeechBackend
            };

            app.manage(backend);
            Ok(())
        })
        .build()
}
