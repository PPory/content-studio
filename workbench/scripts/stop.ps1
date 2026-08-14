#requires -Version 5.1
<#
  停掉后台的 dev server。

  只杀命令行里同时含「这个项目的路径」和「vite」的 node 进程——按进程名杀会把别的项目、
  别的 Node 工具一起带走，而这台机器上同时跑着好几个。
#>

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine -like "*$root*" -and $_.CommandLine -like "*vite*" }

if (-not $procs) {
  Write-Host "没有在跑的 dev server。"
  exit 0
}

foreach ($p in $procs) {
  Stop-Process -Id $p.ProcessId -Force
  Write-Host "stopped  pid $($p.ProcessId)"
}
