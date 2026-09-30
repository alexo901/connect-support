!include "FileFunc.nsh"

; nsExec::ExecToStack preserves Win32 arguments and returns the process exit
; code on top of the stack, followed by captured stdout.
!macro RunSc COMMAND
  nsExec::ExecToStack '"$SYSDIR\sc.exe" ${COMMAND}'
  Pop $R5
  Pop $R6
!macroend

; Stop and delete an existing service. A missing service (1060) is expected.
; Other query failures and a timeout are fatal instead of leaving a broken install.
!macro StopDeleteService PREFIX
  DetailPrint "Checking for an existing Connect Support service..."
  !insertmacro RunSc "query ConnectSupportAgent"
  ${If} $R5 == 1060
    DetailPrint "No existing Connect Support service was found."
    Goto ${PREFIX}_done
  ${ElseIf} $R5 != 0
    MessageBox MB_OK|MB_ICONSTOP "Setup could not check the Connect Support service. Setup will be cancelled."
    Abort
  ${EndIf}

  System::Call 'shlwapi::StrStrW(w r6, w "STOPPED") p.r7'
  ${If} $R7 != 0
    Goto ${PREFIX}_delete
  ${EndIf}
  DetailPrint "Stopping the existing Connect Support service..."
  !insertmacro RunSc "stop ConnectSupportAgent"

  DetailPrint "Waiting for the existing service to stop..."
  StrCpy $R8 0
  ${PREFIX}_wait_stop:
    !insertmacro RunSc "query ConnectSupportAgent"
    ${If} $R5 == 1060
      Goto ${PREFIX}_done
    ${ElseIf} $R5 == 1072
      ; The SCM has marked the service for deletion; keep polling until gone.
      IntOp $R8 $R8 + 1
      ${If} $R8 >= 30
        MessageBox MB_OK|MB_ICONSTOP "The old Connect Support service could not be removed. Setup will be cancelled."
        Abort
      ${EndIf}
      Sleep 1000
      Goto ${PREFIX}_wait_delete
    ${ElseIf} $R5 != 0
      MessageBox MB_OK|MB_ICONSTOP "Setup could not verify the Connect Support service state. Setup will be cancelled."
      Abort
    ${EndIf}
    System::Call 'shlwapi::StrStrW(w r6, w "STOPPED") p.r7'
    ${If} $R7 != 0
      Goto ${PREFIX}_delete
    ${EndIf}
    IntOp $R8 $R8 + 1
    ${If} $R8 >= 30
      MessageBox MB_OK|MB_ICONSTOP "The existing Connect Support service did not stop. Setup will be cancelled."
      Abort
    ${EndIf}
    Sleep 1000
    Goto ${PREFIX}_wait_stop

  ${PREFIX}_delete:
    DetailPrint "Removing the existing Connect Support service..."
    !insertmacro RunSc "delete ConnectSupportAgent"
    ; Poll until the SCM has actually removed it (SCM may report marked-for-delete).
    StrCpy $R8 0
  ${PREFIX}_wait_delete:
    !insertmacro RunSc "query ConnectSupportAgent"
    ${If} $R5 == 1060
      Goto ${PREFIX}_done
    ${ElseIf} $R5 == 1072
      IntOp $R8 $R8 + 1
      ${If} $R8 >= 30
        MessageBox MB_OK|MB_ICONSTOP "The old Connect Support service could not be removed. Setup will be cancelled."
        Abort
      ${EndIf}
      Sleep 1000
      Goto ${PREFIX}_wait_delete
    ${ElseIf} $R5 != 0
      MessageBox MB_OK|MB_ICONSTOP "Setup could not verify removal of the old Connect Support service. Setup will be cancelled."
      Abort
    ${EndIf}
    IntOp $R8 $R8 + 1
    ${If} $R8 >= 30
      MessageBox MB_OK|MB_ICONSTOP "The old Connect Support service could not be removed. Setup will be cancelled."
      Abort
    ${EndIf}
    Sleep 1000
    Goto ${PREFIX}_wait_delete

  ${PREFIX}_done:
!macroend

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

    !insertmacro StopDeleteService InstallService

    DetailPrint "Registering the Connect Support service..."
    ; sc.exe needs the embedded quotes retained as part of its binPath value.
    ; The outer quotes group the value; \$\" emits the inner \" pair
    ; required by Windows command-line parsing (for example Program Files).
    !insertmacro RunSc 'create ConnectSupportAgent binPath= "\$\"$INSTDIR\resources\windows-service\ConnectSupportService.exe\$\"" start= auto obj= LocalSystem DisplayName= "Connect Support Agent"'
    ${If} $R5 != 0
      MessageBox MB_OK|MB_ICONSTOP "Could not register the Connect Support service. Setup will be cancelled."
      Abort
    ${EndIf}

    DetailPrint "Verifying the Connect Support service registration..."
    !insertmacro RunSc "query ConnectSupportAgent"
    ${If} $R5 != 0
      MessageBox MB_OK|MB_ICONSTOP "The Connect Support service was not registered. Setup will be cancelled."
      Abort
    ${EndIf}
    System::Call 'shlwapi::StrStrW(w r6, w "ConnectSupportAgent") p.r7'
    ${If} $R7 == 0
      MessageBox MB_OK|MB_ICONSTOP "The Connect Support service could not be verified. Setup will be cancelled."
      Abort
    ${EndIf}

    DetailPrint "Verifying the service path, account, and automatic startup..."
    !insertmacro RunSc "qc ConnectSupportAgent"
    ${If} $R5 != 0
      MessageBox MB_OK|MB_ICONSTOP "Setup could not verify the Connect Support service configuration. Setup will be cancelled."
      Abort
    ${EndIf}
    System::Call 'shlwapi::StrStrW(w r6, w "$\"$INSTDIR\resources\windows-service\ConnectSupportService.exe$\"") p.r7'
    ${If} $R7 == 0
      MessageBox MB_OK|MB_ICONSTOP "The Connect Support service executable path was not correctly quoted. Setup will be cancelled."
      Abort
    ${EndIf}
    System::Call 'shlwapi::StrStrW(w r6, w "AUTO_START") p.r7'
    ${If} $R7 == 0
      MessageBox MB_OK|MB_ICONSTOP "The Connect Support service is not configured for automatic startup. Setup will be cancelled."
      Abort
    ${EndIf}
    System::Call 'shlwapi::StrStrW(w r6, w "LocalSystem") p.r7'
    ${If} $R7 == 0
      MessageBox MB_OK|MB_ICONSTOP "The Connect Support service account could not be verified. Setup will be cancelled."
      Abort
    ${EndIf}

    DetailPrint "Starting the Connect Support service..."
    !insertmacro RunSc "start ConnectSupportAgent"
    ${If} $R5 != 0
      MessageBox MB_OK|MB_ICONSTOP "Could not start the Connect Support service. Setup will be cancelled."
      Abort
    ${EndIf}

    DetailPrint "Waiting for the Connect Support service to start..."
    StrCpy $R8 0
  InstallService_wait_running:
    !insertmacro RunSc "query ConnectSupportAgent"
    ${If} $R5 != 0
      MessageBox MB_OK|MB_ICONSTOP "The Connect Support service stopped responding during startup. Setup will be cancelled."
      Abort
    ${EndIf}
    System::Call 'shlwapi::StrStrW(w r6, w "RUNNING") p.r7'
    ${If} $R7 != 0
      Goto InstallService_running
    ${EndIf}
    System::Call 'shlwapi::StrStrW(w r6, w "STOPPED") p.r7'
    ${If} $R7 != 0
      MessageBox MB_OK|MB_ICONSTOP "The Connect Support service stopped during startup. Setup will be cancelled."
      Abort
    ${EndIf}
    IntOp $R8 $R8 + 1
    ${If} $R8 >= 30
      MessageBox MB_OK|MB_ICONSTOP "The Connect Support service did not start in time. Setup will be cancelled."
      Abort
    ${EndIf}
    Sleep 1000
    Goto InstallService_wait_running

  InstallService_running:
    DetailPrint "Connect Support service is running."
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
  DetailPrint "Removing the Connect Support service..."
  !insertmacro StopDeleteService UninstallService
  DetailPrint "Connect Support service removal verified."
!macroend
