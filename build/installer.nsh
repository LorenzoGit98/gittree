; Assisted NSIS: keep the full wizard on fresh install, but on
; electron-updater relaunches (--updated / ${isUpdated}) show only
; the INSTFILES progress page, then relaunch the app.

!macro customInstallMode
  ${if} ${isUpdated}
    ${if} $hasPerMachineInstallation == "1"
    ${andif} $hasPerUserInstallation == "0"
      StrCpy $isForceMachineInstall "1"
    ${else}
      StrCpy $isForceCurrentInstall "1"
    ${endif}
  ${endif}
!macroend

!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  Function finishPagePre
    ${if} ${isUpdated}
      HideWindow
      Call StartApp
      Abort
    ${endif}
  FunctionEnd

  !ifndef HIDE_RUN_AFTER_FINISH
    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !endif
  !define MUI_PAGE_CUSTOMFUNCTION_PRE finishPagePre
  !insertmacro MUI_PAGE_FINISH
!macroend
