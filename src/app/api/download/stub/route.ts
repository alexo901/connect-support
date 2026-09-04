import { NextRequest, NextResponse } from "next/server";

// This endpoint serves a code-specific PowerShell bootstrap installer.

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code") || "000000";
  const serverUrl = process.env.SOCKET_SERVER_URL ||
    "https://supportas-fxdwbkfyfgfbg2g5.canadacentral-01.azurewebsites.net";
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Invalid support code" }, { status: 400 });
  }

  const lines: string[] = [
    "# Connect Support Agent Installer",
    `# Support Code: ${code}`,
    "# Auto-generated installer stub",
    "",
    "$ErrorActionPreference = 'Stop'",
    `$serverUrl = '${serverUrl}'`,
    `$supportCode = '${code}'`,
    "$installer = Join-Path $env:TEMP ('connect-support-setup-' + $supportCode + '.exe')",
    "",
    "Write-Host 'Connect Support - Downloading installer...'",
    "$installerUrl = $serverUrl + '/api/download/installer-file?code=' + $supportCode",
    "Invoke-WebRequest -Uri $installerUrl -OutFile $installer -UseBasicParsing",
    "",
    "Write-Host 'Connect Support - Installing agent...'",
    "Start-Process -FilePath $installer -ArgumentList '/S' -Wait",
    "Remove-Item $installer -Force -ErrorAction SilentlyContinue",
    "",
    "# Locate the EXE installed by NSIS",
    "$exeFile = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Programs') -Filter 'Connect Support.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1",
    "if (-not $exeFile) { Write-Error 'Connect Support.exe was not found after installation'; exit 1 }",
    "$agentExe = $exeFile.FullName",
    "$realAgentDir = $exeFile.DirectoryName",
    "",
    "# Write config beside the actual EXE",
    "$config = @{ serverUrl = $serverUrl; supportCode = $supportCode; unattendedAccess = $false; consentAsked = $false } | ConvertTo-Json",
    "Set-Content -Path (Join-Path $realAgentDir 'config.json') -Value $config -Encoding UTF8",
    "# Also replace stale Electron userData config",
    "$userDataDir = Join-Path $env:APPDATA 'connect-support-agent'",
    "New-Item -ItemType Directory -Force -Path $userDataDir | Out-Null",
    "Set-Content -Path (Join-Path $userDataDir 'config.json') -Value $config -Encoding UTF8",
    "",
    "# Set auto-start with exact production arguments",
    "$regPath = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'",
    "Set-ItemProperty -Path $regPath -Name 'ConnectSupportAgent' -Value \"`\"$agentExe`\" --hidden --code=$supportCode --server=$serverUrl\"",
    "Start-Process -FilePath $agentExe -ArgumentList \"--hidden\",\"--code=$supportCode\",\"--server=$serverUrl\" -WindowStyle Hidden",
    "Write-Host ('Connect Support Agent started with code ' + $supportCode)",
  ];
  const psScript = lines.join("\n");

  return new NextResponse(psScript, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="ConnectSupport-Setup-${code}.ps1"`,
    },
  });
}
