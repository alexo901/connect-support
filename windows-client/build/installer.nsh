!include "FileFunc.nsh"

!macro customInstall
  DetailPrint "Writing Connect Support agent configuration..."
  ${GetFileName} "$EXEPATH" $R0
  StrCpy $R2 $R0 1 -11
  StrCmp $R2 "-" 0 invalidSupportCode
  StrCpy $R1 $R0 6 -10
  IntOp $R3 $R1 + 0
  IntFmt $R4 "%06d" $R3
  StrCmp $R4 $R1 validSupportCode invalidSupportCode

  validSupportCode:
    FileOpen $R5 "$INSTDIR\config.json" w
    IfErrors failedConfigWrite
    FileWrite $R5 '{"serverUrl":"https://supportas-fxdwbkfyfgfbg2g5.canadacentral-01.azurewebsites.net","supportCode":"$R1","unattendedAccess":false,"consentAsked":true}'
    FileClose $R5

    DetailPrint "Registering the Connect Support Windows service..."
    ExecWait '"$SYSDIR\sc.exe" query ConnectSupportAgent' $R5
    ${If} $R5 == 0
      ExecWait '"$SYSDIR\sc.exe" stop ConnectSupportAgent' $R5
      Sleep 6000
      ExecWait '"$SYSDIR\sc.exe" delete ConnectSupportAgent' $R5
      ${If} $R5 != 0
        MessageBox MB_OK|MB_ICONSTOP "Could not remove the previous Connect Support service (error $R5). Setup will be cancelled."
        Abort
      ${EndIf}
      Sleep 1000
    ${EndIf}
    ExecWait '"$SYSDIR\sc.exe" create ConnectSupportAgent binPath= "$\"$INSTDIR\resources\windows-service\ConnectSupportService.exe$\"" start= auto obj= LocalSystem DisplayName= "Connect Support Agent"' $R5
    ${If} $R5 != 0
      ExecWait '"$SYSDIR\sc.exe" config ConnectSupportAgent binPath= "$\"$INSTDIR\resources\windows-service\ConnectSupportService.exe$\"" start= auto obj= LocalSystem DisplayName= "Connect Support Agent"' $R5
    ${EndIf}
    ${If} $R5 != 0
      MessageBox MB_OK|MB_ICONSTOP "Could not register the Connect Support service (error $R5). Setup will be cancelled."
      Abort
    ${EndIf}

    ExecWait '"$SYSDIR\sc.exe" description ConnectSupportAgent "Connect Support Agent"' $R5
    ${If} $R5 != 0
      MessageBox MB_OK|MB_ICONSTOP "Could not configure the Connect Support service description (error $R5). Setup will be cancelled."
      Abort
    ${EndIf}

    DetailPrint "Starting the Connect Support service..."
    ExecWait '"$SYSDIR\sc.exe" start ConnectSupportAgent' $R5
    ${If} $R5 != 0
      MessageBox MB_OK|MB_ICONSTOP "Could not start the Connect Support service (error $R5). Setup will be cancelled."
      Abort
    ${EndIf}
    Goto installComplete

  invalidSupportCode:
    MessageBox MB_OK|MB_ICONSTOP "This installer does not contain a valid six-digit support code. Please download it again from your technician's support link."
    Abort

  failedConfigWrite:
    MessageBox MB_OK|MB_ICONSTOP "Could not write the Connect Support agent configuration. Setup will be cancelled."
    Abort

  installComplete:
!macroend

!macro customUnInstall
  DetailPrint "Stopping and removing the Connect Support Windows service..."
  ExecWait '"$SYSDIR\sc.exe" query ConnectSupportAgent' $R5
  ${If} $R5 == 0
    ExecWait '"$SYSDIR\sc.exe" stop ConnectSupportAgent' $R5
    Sleep 6000
    ExecWait '"$SYSDIR\sc.exe" delete ConnectSupportAgent' $R5
    ${If} $R5 != 0
      MessageBox MB_OK|MB_ICONSTOP "Could not remove the Connect Support service (error $R5). Uninstall was stopped to avoid leaving an orphaned service."
      Abort
    ${EndIf}
  ${EndIf}
!macroend
