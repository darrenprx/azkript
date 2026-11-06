; Keep Azkript available in Open With without replacing another editor's default.
; electron-builder's stock APP_ASSOCIATE writes the extension default first;
; snapshot both registry contexts before install and restore after registration.
; Windows UserChoice is never read, rewritten or deleted.
!ifndef BUILD_UNINSTALLER
  Var AzkriptPreviousFdxUser
  Var AzkriptPreviousFdxUserPresent
  Var AzkriptPreviousFdxtUser
  Var AzkriptPreviousFdxtUserPresent
  Var AzkriptPreviousFdxMachine
  Var AzkriptPreviousFdxMachinePresent
  Var AzkriptPreviousFdxtMachine
  Var AzkriptPreviousFdxtMachinePresent
!endif

!macro AzkriptRememberDefault EXT NAME ROOT CONTEXT
  StrCpy $AzkriptPrevious${NAME}${CONTEXT}Present "1"
  ClearErrors
  ReadRegStr $AzkriptPrevious${NAME}${CONTEXT} ${ROOT} "Software\Classes\.${EXT}" ""
  ${If} ${Errors}
    StrCpy $AzkriptPrevious${NAME}${CONTEXT}Present "0"
  ${EndIf}
!macroend

!macro customInit
  !insertmacro AzkriptRememberDefault "fdx" "Fdx" HKCU "User"
  !insertmacro AzkriptRememberDefault "fdxt" "Fdxt" HKCU "User"
  !insertmacro AzkriptRememberDefault "fdx" "Fdx" HKLM "Machine"
  !insertmacro AzkriptRememberDefault "fdxt" "Fdxt" HKLM "Machine"
!macroend

!macro AzkriptRestoreDefault EXT NAME CONTEXT
  ${If} $AzkriptPrevious${NAME}${CONTEXT}Present == "1"
  ${AndIf} $AzkriptPrevious${NAME}${CONTEXT} != "Azkript Screenplay"
    WriteRegStr SHELL_CONTEXT "Software\Classes\.${EXT}" "" $AzkriptPrevious${NAME}${CONTEXT}
  ${Else}
    ; Also clean the implicit default left by an older Azkript installer.
    DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}" ""
  ${EndIf}
!macroend

!macro customInstall
  ${If} $installMode == "all"
    !insertmacro AzkriptRestoreDefault "fdx" "Fdx" "Machine"
    !insertmacro AzkriptRestoreDefault "fdxt" "Fdxt" "Machine"
  ${Else}
    !insertmacro AzkriptRestoreDefault "fdx" "Fdx" "User"
    !insertmacro AzkriptRestoreDefault "fdxt" "Fdxt" "User"
  ${EndIf}
  ; Quote the executable separately from the document argument, including when
  ; the chosen installation directory contains spaces.
  WriteRegStr SHELL_CONTEXT "Software\Classes\Azkript Screenplay\shell\open\command" "" '$\"$INSTDIR\Azkript.exe$\" $\"%1$\"'
!macroend

!macro AzkriptRemoveLegacyDefault EXT
  ReadRegStr $R8 SHELL_CONTEXT "Software\Classes\.${EXT}" ""
  ${If} $R8 == "Azkript Screenplay"
    DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}" ""
  ${EndIf}
!macroend

!macro customUnInstall
  ; Stock APP_UNASSOCIATE removes OpenWithProgids and the product class, but
  ; leaves the extension default. Never leave a pointer to a deleted class.
  !insertmacro AzkriptRemoveLegacyDefault "fdx"
  !insertmacro AzkriptRemoveLegacyDefault "fdxt"
!macroend
