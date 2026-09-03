import { NextRequest, NextResponse } from "next/server";

// This endpoint serves a PowerShell-based stub launcher script.
// In production, replace with a real signed .exe stub.

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code") || "000000";
  const serverUrl =
    process.env.NEXT_PUBLIC_SOCKET_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  const lines: string[] = [
    "# Connect Support Agent Installer",
    `# Support Code: ${code}`,
    "# Auto-generated installer stub",
    "",
    "$ErrorActionPreference = 'Stop'",
    `$serverUrl = '${serverUrl}'`,
    `$supportCode = '${code}'`,
    "$agentDir = Join-Path $env:LOCALAPPDATA 'ConnectSupport'",
    "$agentZip = Join-Path $env:TEMP 'cs-agent.zip'",
    "",
    "Write-Host 'Connect Support - Installing agent...'",
    "New-Item -ItemType Directory -Force -Path $agentDir | Out-Null",
    "",
    "# Download full agent from GitHub Releases",
    "$releaseUrl = 'https://github.com/alexo901/connect-support/releases/latest/download/ConnectSupportAgent-win32-x64.zip'",
    "Invoke-WebRequest -Uri $releaseUrl -OutFile $agentZip -UseBasicParsing",
    "",
    "# Extract",
    "Expand-Archive -Path $agentZip -DestinationPath $agentDir -Force",
    "Remove-Item $agentZip",
    "",
    "# Locate the exe wherever it actually landed (zip may contain a top-level folder)",
    "$exeFile = Get-ChildItem -Path $agentDir -Filter 'ConnectSupportAgent.exe' -Recurse | Select-Object -First 1",
    "if (-not $exeFile) { Write-Error 'ConnectSupportAgent.exe not found after extraction'; exit 1 }",
    "$agentExe = $exeFile.FullName",
    "$realAgentDir = $exeFile.DirectoryName",
    "",
    "# Write config with embedded support code, next to the ACTUAL exe",
    "$config = @{ serverUrl = $serverUrl; supportCode = $supportCode } | ConvertTo-Json",
    "Set-Content -Path (Join-Path $realAgentDir 'config.json') -Value $config",
    "",
    "# Add to Run registry for auto-start (hidden)",
    "$regPath = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'",
    "Set-ItemProperty -Path $regPath -Name 'ConnectSupportAgent' -Value \"`\"$agentExe`\" --hidden\"",
    "",
    "# Start agent silently — note --code=X and --server=X as SINGLE tokens",
    "Start-Process -FilePath $agentExe -ArgumentList \"--hidden\",\"--code=$supportCode\",\"--server=$serverUrl\" -WindowStyle Hidden",
    "",
    "Write-Host 'Connect Support agent installed and running silently.'",
  ];
  const psScript = lines.join("\n");

  return new NextResponse(psScript, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="ConnectSupport-Setup-${code}.ps1"`,
    },
  });
}
