<#
.SYNOPSIS
  给 dsh-chimes 换上你自己的开场音 / 完成音。

.DESCRIPTION
  这个脚本住在仓库里（scripts\install-chime.ps1），插件代码就是仓库本身，
  所以它只做三件事：转码 → 放进 assets\ → （可选）确保插件已装进 DSH profile。

  转码用 ffmpeg：`Media.SoundPlayer` 只支持 PCM WAV，mp3 改名成 .wav 不会响。

.PARAMETER Startup
  开场音效的源文件（mp3 / m4a / wav / ogg / flac…）。不给就跳过不动。

.PARAMETER Done
  完成音效的源文件。不给就跳过不动。

.PARAMETER Profile
  目标 profile，默认 desktop。

.PARAMETER TrimSilence
  是否掐掉开头静音，默认开（否则会「点了图标过一会儿才响」）。

.PARAMETER Volume
  可选增益，例如 0.6 或 1.5。SoundPlayer 没有音量 API，音量只能在这里烘焙。

.PARAMETER SkipInstall
  只放音频，不碰 DSH profile。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\install-chime.ps1 -Startup D:\a.mp3 -Done D:\b.mp3

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\install-chime.ps1 -Done D:\b.mp3 -Volume 0.7
#>
[CmdletBinding()]
param(
  [string]$Startup,
  [string]$Done,
  [string]$Profile = 'desktop',
  [switch]$TrimSilence = $true,
  [double]$Volume = 0,
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
function Info($m) { Write-Host "[*] $m" }
function Ok($m)   { Write-Host "[+] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[!] $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "[x] $m" -ForegroundColor Red; exit 1 }

# Write-Host 只输出 ASCII 之外的说明靠文档；这里保持无 BOM 写入由脚本内部保证。
function Write-Utf8NoBom([string]$Path, [string]$Text) {
  [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding $false))
}

if (-not $Startup -and -not $Done) { Die '至少给一个 -Startup 或 -Done 音频路径。' }

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $repoRoot 'package.json'))) {
  Die "在 $repoRoot 里找不到 package.json —— 请把整个仓库一起拷过来再运行 scripts\install-chime.ps1。"
}
$assets = Join-Path $repoRoot 'assets'
New-Item -ItemType Directory -Force -Path $assets | Out-Null

$ffmpeg = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source

function Install-One([string]$kind, [string]$source, [string]$targetName) {
  if (-not (Test-Path -LiteralPath $source)) { Die "找不到音频文件：$source" }
  $target = Join-Path $assets $targetName
  $isWav = [IO.Path]::GetExtension($source).ToLower() -eq '.wav'

  if ($ffmpeg) {
    $filters = @()
    if ($TrimSilence) { $filters += 'silenceremove=start_periods=1:start_threshold=-50dB' }
    if ($Volume -gt 0) { $filters += "volume=$Volume" }
    $args = @('-y', '-v', 'error', '-i', $source, '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2')
    if ($filters.Count -gt 0) { $args += @('-af', ($filters -join ',')) }
    $args += @('-map_metadata', '-1', '-fflags', '+bitexact', $target)
    & $ffmpeg @args
    if ($LASTEXITCODE -ne 0) { Die "ffmpeg 转换失败：$source" }
    if ($filters.Count -gt 0) { Ok "$kind → $targetName（已应用：$($filters -join ' + ')）" } else { Ok "$kind → $targetName" }
  }
  elseif ($isWav) {
    Copy-Item -LiteralPath $source -Destination $target -Force
    Warn "本机没有 ffmpeg，直接复制了 WAV（未做掐静音/增益）。"
    Ok "$kind → $targetName"
  }
  else {
    Die "本机没有 ffmpeg，而 $source 不是 WAV。请安装 ffmpeg（winget install Gyan.FFmpeg）或直接提供 PCM WAV。"
  }

  $probe = Get-Command ffprobe -ErrorAction SilentlyContinue
  if ($probe) {
    $dur = & $probe.Source -v error -show_entries format=duration -of csv=p=0 $target
    $kb = [math]::Round((Get-Item $target).Length / 1KB)
    Info ("  {0}: {1} KB, {2:N2} 秒" -f $targetName, $kb, [double]$dur)
    if ([double]$dur -gt 6) { Warn '  超过 6 秒偏长，可能会盖住你启动后的第一句话。' }
  }
}

if ($Startup) { Install-One '开场音' $Startup 'chime.wav' }
if ($Done)    { Install-One '完成音' $Done    'success.wav' }

if (-not $SkipInstall) {
  # 找 DSH 安装目录（与旧版安装器同样的探测顺序）
  $dshRoot = $null
  foreach ($key in (Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue)) {
    $p = Get-ItemProperty $key.PSPath -ErrorAction SilentlyContinue
    if ($p.DisplayName -like 'DeepSeek Harness*' -and $p.InstallLocation) { $dshRoot = $p.InstallLocation; break }
  }
  if (-not $dshRoot) {
    foreach ($base in @("$env:LOCALAPPDATA\Programs", $env:ProgramFiles, 'C:\', 'D:\')) {
      if (-not (Test-Path $base)) { continue }
      foreach ($c in (Get-ChildItem $base -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'deepseek|harness' })) {
        if (Test-Path (Join-Path $c.FullName 'resources\runtime\cli\bin\dsh.cmd')) { $dshRoot = $c.FullName; break }
      }
      if ($dshRoot) { break }
    }
  }
  if (-not $dshRoot) { Warn '找不到 DSH 安装目录：音频已就位，但插件需要你手动安装（见 README）。' }
  else {
    $dshCmd = Join-Path $dshRoot 'resources\runtime\cli\bin\dsh.cmd'
    $dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
    $manifest = Join-Path $dshHome "profiles\$Profile\package.json"
    if (-not (Test-Path $manifest)) { Warn "profile '$Profile' 不存在（先启动一次 DSH 桌面版），跳过安装步骤。" }
    else {
      $installed = (Get-Content $manifest -Raw -Encoding utf8 | ConvertFrom-Json).dsh.profile.bundles -contains 'dsh-chimes'
      if ($installed) { Info 'dsh-chimes 已在 profile 里，音频替换即时生效（完成音无需重启）。' }
      else {
        Info '把 dsh-chimes 装进 profile…'
        & $dshCmd plugin --profile $Profile add $repoRoot
        if ($LASTEXITCODE -ne 0) { Warn "安装失败（exit=$LASTEXITCODE）—— 可在 GUI 侧栏「插件」页用本地路径重试。" }
        else { Ok '已安装。' }
      }
    }
  }
}

Write-Host ''
Ok '完成。'
Write-Host '   · 完成音：下一轮对话结束就会用新声音（无需重启）'
Write-Host '   · 开场音：需要重启一次 DSH 才能听到'
Write-Host '   · GUI 里也可以换：设置 → 插件 → Chimes（支持直接选 mp3，浏览器内转换）'
Write-Host "   · 生效文件：$assets\chime.wav 与 $assets\success.wav（已被 .gitignore 排除，不会被提交）"
