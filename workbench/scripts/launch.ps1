#requires -Version 5.1
<#
  点开始菜单里那个图标之后跑的就是这个。

  它干三件事：确认 dev server 在跑（不在就拉起来）、等它通、用 Chrome 的 app 模式开一个
  没有地址栏的窗口。

  为什么冷启动要有启动画面：从点图标到界面出来有 5~10 秒（Vite 首次编译），这段时间里
  屏幕上什么都不变，人的反应一定是再点一次——于是起了第二个进程、抢同一个端口、strictPort
  直接让它挂掉。启动画面不是装饰，是防止用户去做那件会把事情弄坏的事。

  为什么是 app 模式而不是普通标签页：这东西是当应用用的，不该混在一堆浏览器标签里；
  app 窗口在任务栏是独立图标、独立 Alt+Tab 项，切回来的路径和别的应用一样。
#>

param(
  # 只拉服务不开窗口（装开机自启时用得上）
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
# 只有启动画面要在这儿画图标；快捷方式那边用 .ico，app 窗口的图标由页面 favicon 决定
$iconPng = Join-Path $PSScriptRoot "xenho-os-64.png"
$logDir = Join-Path $root "tmp"

# 端口的单一真源是 vite.config.mjs（strictPort，写错了就是起不来），别在这儿抄第二份
$port = 5180
$cfg = Join-Path $root "vite.config.mjs"
if (Test-Path $cfg) {
  $m = [regex]::Match((Get-Content $cfg -Raw), 'port:\s*(\d+)')
  if ($m.Success) { $port = [int]$m.Groups[1].Value }
}
$url = "http://127.0.0.1:$port"

# WinForms 只在真要画东西时才加载：Add-Type 这两个程序集要花将近一秒，而最常走的那条路
# （服务已经在跑，直接开窗口）一个窗体都不需要画。
$script:uiReady = $false
function Use-WinForms {
  if ($script:uiReady) { return }
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  $script:uiReady = $true
}

function Test-Up {
  $c = New-Object Net.Sockets.TcpClient
  try {
    $ok = $c.ConnectAsync("127.0.0.1", $port).Wait(400)
    return $ok -and $c.Connected
  } catch { return $false } finally { $c.Dispose() }
}

function Show-Fail($title, $body) {
  Use-WinForms
  [Windows.Forms.MessageBox]::Show($body, $title, "OK", "Warning") | Out-Null
}

# ── 启动画面：黑底 + logo + 一行状态。无边框、置顶、点不动，成功或超时后自己消失。
function New-Splash {
  Use-WinForms
  $f = New-Object Windows.Forms.Form
  $f.FormBorderStyle = "None"
  $f.StartPosition = "CenterScreen"
  $f.Size = New-Object Drawing.Size(340, 132)
  $f.BackColor = [Drawing.ColorTranslator]::FromHtml("#111318")
  $f.TopMost = $true
  $f.ShowInTaskbar = $false

  # 用旁边那张 png，不用 .ico：见 make-icon.mjs 里那段注释（.NET 的 Icon 不认 PNG 帧，
  # 而 .ico 里 128/256 两档就是 PNG——从 .ico 取图能不能成，取决于你要的是哪一档）
  if (Test-Path $iconPng) {
    $pb = New-Object Windows.Forms.PictureBox
    $pb.Image = [Drawing.Image]::FromFile($iconPng)
    $pb.SizeMode = "Zoom"
    $pb.Location = New-Object Drawing.Point(28, 34)
    $pb.Size = New-Object Drawing.Size(64, 64)
    $pb.BackColor = "Transparent"
    $f.Controls.Add($pb)
  }

  $name = New-Object Windows.Forms.Label
  $name.Text = "Xenho OS"
  $name.Font = New-Object Drawing.Font("Segoe UI Semibold", 15)
  $name.ForeColor = "White"
  $name.AutoSize = $true
  $name.Location = New-Object Drawing.Point(112, 38)
  $f.Controls.Add($name)

  $status = New-Object Windows.Forms.Label
  $status.Text = "正在启动本地服务…"
  $status.Font = New-Object Drawing.Font("Microsoft YaHei", 9)
  $status.ForeColor = [Drawing.ColorTranslator]::FromHtml("#8b8d94")
  $status.AutoSize = $true
  $status.Location = New-Object Drawing.Point(114, 70)
  $f.Controls.Add($status)

  $f.Show()
  [Windows.Forms.Application]::DoEvents()
  return @{ Form = $f; Status = $status }
}

function Open-App {
  if ($NoBrowser) { return }

  # 已经开着就切回去，不再开一个。点任务栏上的应用图标本来就该是「回到那个窗口」，
  # 每点一次多一个窗口是网页的行为，不是应用的行为。
  # 用 AppActivate 而不是 P/Invoke SetForegroundWindow：后者要 Add-Type 编译一段 C#，
  # 半秒起步，而这是最常走的一条路。标题就是 index.html 的 <title>，页面不改它。
  $already = Get-Process chrome, msedge -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle -eq "Xenho OS" }
  if ($already) {
    try {
      if ((New-Object -ComObject WScript.Shell).AppActivate("Xenho OS")) { return }
    } catch {} # 切不过去就照常开一个新的，总比什么都不发生强
  }

  $browsers = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
  ) | Where-Object { Test-Path $_ }

  if ($browsers) {
    # --app 去掉地址栏和标签栏；--start-maximized 直接铺满，省掉每次开完再点一下最大化。
    # 不配 --window-size：两个一起给的时候尺寸会赢，窗口反而不是最大化的。
    Start-Process $browsers[0] -ArgumentList "--app=$url", "--start-maximized"
  } else {
    # 没有 Chromium 系浏览器就退回默认浏览器：多一条地址栏，总比打不开强
    Start-Process $url
  }
}

# ⚠️ 整个主流程必须包在 try 里。这个脚本是 wscript 隐藏起来跑的——**没有控制台**，
# 任何未捕获的异常都是纯静默的：图标点了，什么都不发生，日志里也没有。
# 踩过一次：Icon.ToBitmap 抛异常，现象是「点了没反应」，查了两轮才想到去前台跑一遍。
try {
  # ── 已经在跑：直接开窗口，不碰服务
  if (Test-Up) { Open-App; exit 0 }

  # ── 没在跑：先做能提前发现的检查，别让人对着启动画面等 90 秒才知道是没装依赖
  $vite = Join-Path $root "node_modules\vite\bin\vite.js"
  if (-not (Test-Path $vite)) {
    Show-Fail "Xenho OS 起不来" "依赖还没装。`n`n在项目目录跑一次：`n    npm install`n`n$root"
    exit 1
  }
  $node = (Get-Command node.exe -ErrorAction SilentlyContinue)
  if (-not $node) {
    Show-Fail "Xenho OS 起不来" "PATH 里找不到 node。`n`n装一个 Node 20+（本机原来是 22），或者检查环境变量。"
    exit 1
  }

  if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
  $outLog = Join-Path $logDir "dev-server.log"
  $errLog = Join-Path $logDir "dev-server.err.log"

  # WB_LAUNCHER 让 vite.config.mjs 关掉 open：不关的话它会另外弹一个普通浏览器标签，
  # 加上我们这个 app 窗口就是同一个工作台开两遍。
  $env:WB_LAUNCHER = "1"
  # 重定向到文件（而不是 .NET 的管道）：Vite 每次热更新都会写日志，管道没人读满了就会
  # 把服务卡死；写文件是操作系统在收，不用管。
  Start-Process -FilePath $node.Source -ArgumentList $vite `
    -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog | Out-Null

  $splash = New-Splash
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $timeout = 90
  $up = $false
  while ($sw.Elapsed.TotalSeconds -lt $timeout) {
    if (Test-Up) { $up = $true; break }
    # 十几秒还没好是正常的（首次要预打包依赖），但得说出来，不然沉默就等于「卡住了」
    if ($sw.Elapsed.TotalSeconds -gt 12) {
      $splash.Status.Text = "首次启动要预打包依赖，再等一会儿…"
    }
    [Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 250
  }
  $splash.Form.Close()
  $splash.Form.Dispose()

  if (-not $up) {
    $tail = ""
    if (Test-Path $errLog) { $tail = (Get-Content $errLog -Tail 12 -ErrorAction SilentlyContinue) -join "`n" }
    if (-not $tail -and (Test-Path $outLog)) { $tail = (Get-Content $outLog -Tail 12 -ErrorAction SilentlyContinue) -join "`n" }
    Show-Fail "Xenho OS 没起来" "等了 $timeout 秒，$url 还是不通。`n`n日志：$errLog`n`n$tail"
    exit 1
  }

  Open-App
} catch {
  if ($splash -and $splash.Form) { try { $splash.Form.Close() } catch {} }
  Show-Fail "Xenho OS 启动器出错了" "$($_.Exception.Message)`n`n$($_.InvocationInfo.PositionMessage)"
  exit 1
}
