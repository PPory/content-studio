#requires -Version 5.1
<#
  把工作台装成一个能在开始菜单里搜到、能右键固定到任务栏的应用。

    npm run app:install            开始菜单
    npm run app:install -- -Desktop   顺便放一份到桌面

  桌面默认不放：这台机器的桌面有自动归档（tidy-desktop），扔个 .lnk 上去迟早被扫走。

  卸载就是删掉那个 .lnk，别的什么都没动——没写注册表、没装服务、没改系统设置。
#>

param(
  [switch]$Desktop,
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$icon = Join-Path $PSScriptRoot "xenho-os.ico"
$vbs = Join-Path $PSScriptRoot "launch.vbs"
$name = "Xenho OS.lnk"

$targets = @((Join-Path ([Environment]::GetFolderPath("Programs")) $name))
if ($Desktop) { $targets += (Join-Path ([Environment]::GetFolderPath("Desktop")) $name) }

if ($Uninstall) {
  foreach ($t in @((Join-Path ([Environment]::GetFolderPath("Programs")) $name),
                   (Join-Path ([Environment]::GetFolderPath("Desktop")) $name))) {
    if (Test-Path $t) { Remove-Item $t -Force; Write-Host "removed  $t" }
  }
  Write-Host "`n快捷方式已删。固定在任务栏上的那个要手动右键取消固定。"
  exit 0
}

# 图标是生成物，不进 git；没有就现做一个
if (-not (Test-Path $icon)) {
  Write-Host "generating icon..."
  & node (Join-Path $PSScriptRoot "make-icon.mjs")
}
if (-not (Test-Path $vbs)) { throw "缺 launch.vbs：$vbs" }

$shell = New-Object -ComObject WScript.Shell
$movedFrom = ""
foreach ($t in $targets) {
  $lnk = $shell.CreateShortcut($t)
  # 已经装过、而且指的是别的目录 = 项目搬过家。记下来，装完要多说一句（见文件末尾）
  if ($lnk.Arguments -and $lnk.Arguments -notlike "*$PSScriptRoot*") {
    $movedFrom = $lnk.Arguments.Trim('"')
  }
  # 指向 wscript 而不是 powershell：见 launch.vbs 顶部那段注释（不闪黑窗）
  $lnk.TargetPath = Join-Path $env:SystemRoot "System32\wscript.exe"
  $lnk.Arguments = """$vbs"""
  $lnk.WorkingDirectory = $root
  $lnk.IconLocation = "$icon,0"
  $lnk.Description = "创作工作台 — 流水线 / 书架 / 热点 / 数据"
  $lnk.WindowStyle = 7  # 最小化：万一 wscript 真弹了什么，也不该抢焦点
  $lnk.Save()
  Write-Host "installed  $t"
}

if ($movedFrom) {
  # 任务栏的固定项是 Windows 复制出去的一份**独立** .lnk，不是开始菜单那个的引用——
  # 重装只改得到开始菜单这一份，固定项还指着老目录，而它点下去多半是「什么都不发生」。
  Write-Host @"

⚠ 上一次装的指向的是另一个目录：
    $movedFrom
  开始菜单这份已经改指过来了。**如果之前固定到过任务栏，那一份不会跟着改**：
  右键取消固定，再从开始菜单重新固定一次。
"@
}

Write-Host @"

装好了。现在可以：
  · 按 Win 键搜「Xenho」直接回车
  · 在搜索结果上右键 →「固定到任务栏」/「固定到开始屏幕」

关掉窗口不会停服务（工作台本来就常驻）。真要停：npm run app:stop
"@
