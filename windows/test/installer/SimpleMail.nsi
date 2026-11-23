; SimpleMail – Windows-Installer (NSIS 3, ohne Administratorrechte, Installation pro Benutzer)
; Aufruf: makensis -DVERSION=3.2.40 -DSRC=<Ordner SimpleMail-win32-x64> -DICON=<icon.ico> -DOUT=<Setup.exe> SimpleMail.nsi
; Bequemer: bash installer/build.sh (Paket + Setup + portable Zip)
Unicode true
!include "MUI2.nsh"

Name "SimpleMail ${VERSION}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\SimpleMail"
InstallDirRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SimpleMail" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "SimpleMail ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "SimpleMail"
VIAddVersionKey "FileDescription" "SimpleMail Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "CompanyName" "Ortwin"
VIAddVersionKey "LegalCopyright" "Ortwin"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\SimpleMail.exe"
!define MUI_FINISHPAGE_RUN_TEXT "SimpleMail jetzt starten"
!define MUI_WELCOMEPAGE_TEXT "Dieser Assistent installiert SimpleMail ${VERSION} für dein Benutzerkonto (keine Administratorrechte nötig).$\r$\n$\r$\nDeine Konten, Regeln und Einstellungen bleiben bei einem Update erhalten.$\r$\n$\r$\nFalls SimpleMail läuft, wird es vor der Installation beendet."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "German"

!macro CloseSimpleMail
  nsExec::Exec 'taskkill /IM SimpleMail.exe'
  Sleep 1500
  nsExec::Exec 'taskkill /F /IM SimpleMail.exe'
  Sleep 500
!macroend

Section "SimpleMail" SecMain
  SectionIn RO
  SetShellVarContext current
  !insertmacro CloseSimpleMail
  ; alte Programmdateien ersetzen (Benutzerdaten liegen in %APPDATA% und bleiben)
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  SetOutPath "$INSTDIR"
  File /r "${SRC}\*.*"
  WriteUninstaller "$INSTDIR\Deinstallieren.exe"
  CreateShortCut "$SMPROGRAMS\SimpleMail.lnk" "$INSTDIR\SimpleMail.exe" "" "$INSTDIR\SimpleMail.exe" 0
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SimpleMail" "DisplayName" "SimpleMail"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SimpleMail" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SimpleMail" "Publisher" "Ortwin"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SimpleMail" "DisplayIcon" "$INSTDIR\SimpleMail.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SimpleMail" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SimpleMail" "UninstallString" '"$INSTDIR\Deinstallieren.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SimpleMail" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SimpleMail" "NoRepair" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SimpleMail" "EstimatedSize" 400000
SectionEnd

Section "Verknüpfung auf dem Desktop" SecDesktop
  SetShellVarContext current
  CreateShortCut "$DESKTOP\SimpleMail.lnk" "$INSTDIR\SimpleMail.exe" "" "$INSTDIR\SimpleMail.exe" 0
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  !insertmacro CloseSimpleMail
  Delete "$SMPROGRAMS\SimpleMail.lnk"
  Delete "$DESKTOP\SimpleMail.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SimpleMail"
  ; Anmeldung als Mailprogramm entfernen
  DeleteRegKey HKCU "Software\Classes\SimpleMail.mailto"
  DeleteRegKey HKCU "Software\Clients\Mail\SimpleMail"
  DeleteRegValue HKCU "Software\RegisteredApplications" "SimpleMail"
  ; Konten, Regeln und Einstellungen (%APPDATA%\SimpleMail) bleiben erhalten
SectionEnd
