; TTerm NSIS installer hooks — Explorer "Open in TTerm" context menu entries.
; Included by tauri-bundler's installer.nsi (bundle > windows > nsis > installerHooks).
; SHCTX resolves to HKCU for currentUser installs (no admin needed) and
; ${MAINBINARYNAME} / $INSTDIR are defined by the main template.

!macro NSIS_HOOK_POSTINSTALL
  ; Right-click on empty space inside a folder (background)
  WriteRegStr SHCTX "Software\Classes\Directory\Background\shell\TTerm" "" "Open in TTerm"
  WriteRegStr SHCTX "Software\Classes\Directory\Background\shell\TTerm" "Icon" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\""
  WriteRegStr SHCTX "Software\Classes\Directory\Background\shell\TTerm\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --working-directory $\"%V$\""

  ; Right-click on a folder itself
  WriteRegStr SHCTX "Software\Classes\Directory\shell\TTerm" "" "Open in TTerm"
  WriteRegStr SHCTX "Software\Classes\Directory\shell\TTerm" "Icon" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\""
  WriteRegStr SHCTX "Software\Classes\Directory\shell\TTerm\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --working-directory $\"%1$\""
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey SHCTX "Software\Classes\Directory\Background\shell\TTerm"
  DeleteRegKey SHCTX "Software\Classes\Directory\shell\TTerm"
!macroend
