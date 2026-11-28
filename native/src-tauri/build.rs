fn main() {
    // `renewal-speech` 是应用内联插件（不是独立 crate），必须在这里声明它
    // 有哪些命令，Tauri 才会自动生成 allow-*/deny-* 权限并让 ACL 放行。
    // 漏掉这一步时，前端 invoke 会因为缺少权限被拒绝，表现为“识别没反应”。
    let speech = tauri_build::InlinedPlugin::new()
        .commands(&[
            "speech_is_available", "speech_recognize", "speech_cancel",
            "speech_stop", "speech_speak", "speech_cancel_speech",
            "speech_is_speech_available",
        ]);

    tauri_build::try_build(
        tauri_build::Attributes::new().plugin("renewal-speech", speech)
    )
    .expect("failed to run tauri-build");
}
