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

# 端口通了，不代表坐在上面的是**这个目录**的工作台。
# 这台机器上不止一份 workbench（搬过家、旧副本还带着自己的 node_modules 和 .env），
# 而端口是 strictPort 写死的：旧副本先起来的话，点图标打开的是另一份——界面一模一样、
# 数据是另一份，**没有任何地方会说出这件事**。你会以为自己在改的东西没生效。
# 返回占用者的项目根目录；没人占返回 $null，认不出来返回空串。
function Get-PortOwnerRoot {
  try {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -First 1
  } catch { return "" }
  if (-not $conn) { return $null }
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)" -ErrorAction SilentlyContinue
  if (-not $p -or -not $p.CommandLine) { return "" }
  # 命令行长这样：`"…\node.exe" <root>\node_modules\vite\bin\vite.js`。
  # `[^"']*?` 过不了引号，所以匹配不会从前面那个 node.exe 的盘符起头。
  $m = [regex]::Match($p.CommandLine, '([A-Za-z]:[^"'']*?)\\node_modules\\vite\\bin\\vite\.js')
  if ($m.Success) { return $m.Groups[1].Value.TrimEnd('\') }
  return ""
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
  if (Test-Up) {
    $owner = Get-PortOwnerRoot
    # 只在**认准了是别人**的时候拦。认不出来（空串）照旧放行——宁可少拦一次，
    # 也不能让一个命令行长得不一样的环境把启动器整个堵死。
    if ($owner -and $owner -ne $root.TrimEnd('\')) {
      $msg = "端口 $port 被另一份工作台占着：`n`n    $owner`n`n" +
             "要开的是这一份：`n`n    $root`n`n" +
             "两份界面一模一样，直接开等于在看另一份的数据。先去那个目录停掉它（npm run app:stop），再点一次图标。"
      Show-Fail "Xenho OS 打不开" $msg
      exit 1
    }
    Open-App
    exit 0
  }

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

  # ── 代理：**不能指望继承来的环境变量**
  #
  # workers.dev 在这条网络上要走代理才通（不走就是 DNS 被污染后的连接超时）。
  # `server/lib/fetch.mjs` 认 HTTPS_PROXY，但从开始菜单点图标起的进程，环境是从
  # **Explorer** 继承的，而 Explorer 的环境是登录那一刻的快照——后来才设的用户变量
  # 到不了它那儿。症状极具误导性：终端里 `npm run dev` 一切正常，点图标起来的同一份
  # 代码每个面板都是「连不上 Worker：fetch failed」，而提示还让你去查 .env。
  #
  # 所以这里不读继承值，直接问持久化的那几处（用户级 → 机器级 → 系统代理设置）。
  function Resolve-Proxy {
    foreach ($scope in "User", "Machine") {
      foreach ($name in "HTTPS_PROXY", "HTTP_PROXY") {
        $v = [Environment]::GetEnvironmentVariable($name, $scope)
        if ($v) { return $v.Trim() }
      }
    }
    # IE/系统代理面板那一份（勾了「使用代理服务器」但没设环境变量的情况）
    try {
      $k = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings" -ErrorAction Stop
      if ($k.ProxyEnable -eq 1 -and $k.ProxyServer) {
        $s = [string]$k.ProxyServer
        # 可能是 `host:port`，也可能是 `http=…;https=…` 这种分协议写法
        if ($s -match '(?i)https?=([^;]+)') { $s = $Matches[1] }
        elseif ($s -match ';') { return "" }
        if ($s -notmatch '^\w+://') { $s = "http://$s" }
        return $s.Trim()
      }
    } catch {}
    return ""
  }
  if (-not $env:HTTPS_PROXY) {
    $proxy = Resolve-Proxy
    if ($proxy) { $env:HTTPS_PROXY = $proxy }
  }
  # 本机地址永远直连。fetch.mjs 里也硬编码了 localhost/127.0.0.1，这里是把用户自己配的
  # 那份一起带过去（比如额外放行了内网域名）。
  if (-not $env:NO_PROXY) {
    $np = [Environment]::GetEnvironmentVariable("NO_PROXY", "User")
    if (-not $np) { $np = [Environment]::GetEnvironmentVariable("NO_PROXY", "Machine") }
    if ($np) { $env:NO_PROXY = $np }
  }
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
