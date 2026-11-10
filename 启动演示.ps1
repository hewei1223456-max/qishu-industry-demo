$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodeCandidates = @()
if ($nodeCommand) { $nodeCandidates += $nodeCommand.Source }
$nodeCandidates += 'C:\Program Files\nodejs\node.exe'
$runtimePackage = Get-AppxPackage -Name 'OpenAI.CodexPrimaryRuntime*' -ErrorAction SilentlyContinue | Sort-Object Version -Descending | Select-Object -First 1
if ($runtimePackage) { $nodeCandidates += Join-Path $runtimePackage.InstallLocation 'dependencies\node\bin\node.exe' }
$nodeRuntime = $null
foreach ($candidate in $nodeCandidates) {
    if (Test-Path -LiteralPath $candidate) {
        $version = & $candidate --version
        if ($version -match '^v(\d+)\.' -and [int]$Matches[1] -ge 24) { $nodeRuntime = $candidate; break }
    }
}
if (-not $nodeRuntime) { throw '没有找到 Node.js。请安装 Node.js 24 LTS，或在 Codex 运行时内启动。' }
$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
if (-not $env:QISHU_PYTHON -and $pythonCommand) { $env:QISHU_PYTHON = $pythonCommand.Source }
if (-not $env:QISHU_PYTHON -and $runtimePackage) {
    $pythonRuntime = Join-Path $runtimePackage.InstallLocation 'dependencies\python\python.exe'
    if (Test-Path -LiteralPath $pythonRuntime) { $env:QISHU_PYTHON = $pythonRuntime }
}
Set-Location -LiteralPath $projectRoot
$targetPort = if ($env:PORT) { $env:PORT } else { '4188' }
Write-Output "七叔平台本地演示启动后，请访问 http://127.0.0.1:$targetPort"
Write-Output '这是前台、厂家后台与平台后台共用的数据服务。关闭本窗口即停止本地服务。'
& $nodeRuntime --env-file-if-exists=.env (Join-Path $projectRoot 'apps\server\src\server.js')
