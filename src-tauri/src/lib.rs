// VI_VERSION_VISIBILITY_STANDARD (2026-05-18): customiza menu nativo
// macOS para incluir AboutMetadata estruturado no item "Sobre o
// VoiceIdeas" (nome + versão do Cargo.toml + copyright + website).
//
// Em outras plataformas (Linux/Windows) o menu default do Tauri é
// mantido — a customização só vale para macOS por enquanto.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_deep_link::init());

  #[cfg(target_os = "macos")]
  let builder = builder.setup(|app| {
    use tauri::menu::{AboutMetadataBuilder, MenuBuilder, SubmenuBuilder};

    let about_metadata = AboutMetadataBuilder::new()
      .name(Some("VoiceIdeas"))
      .version(Some(env!("CARGO_PKG_VERSION")))
      .copyright(Some("© 2026 Agência Capitólio"))
      .website(Some("https://voiceideas.vercel.app"))
      .website_label(Some("voiceideas.vercel.app"))
      .build();

    let app_submenu = SubmenuBuilder::new(app, "VoiceIdeas")
      .about(Some(about_metadata))
      .separator()
      .services()
      .separator()
      .hide()
      .hide_others()
      .show_all()
      .separator()
      .quit()
      .build()?;

    let edit_submenu = SubmenuBuilder::new(app, "Editar")
      .undo()
      .redo()
      .separator()
      .cut()
      .copy()
      .paste()
      .select_all()
      .build()?;

    let view_submenu = SubmenuBuilder::new(app, "Visualizar")
      .fullscreen()
      .build()?;

    let window_submenu = SubmenuBuilder::new(app, "Janela")
      .minimize()
      .maximize()
      .build()?;

    let menu = MenuBuilder::new(app)
      .items(&[&app_submenu, &edit_submenu, &view_submenu, &window_submenu])
      .build()?;

    app.set_menu(menu)?;
    Ok(())
  });

  builder
    .run(tauri::generate_context!())
    .expect("error while running VoiceIdeas");
}
