<#
.SYNOPSIS
  把 dsh-chimes 发布到 GitHub（填占位符 → 提交 → 推送到你自己新建的空仓库）。

.DESCRIPTION
  为什么需要你自己跑这个脚本：

    1. 认证必须是你的 —— 脚本用的是你机器上 git 的凭据（凭据管理器 / gh），
       不要把 token 交给任何人；
    2. 我这个 agent 的 shell 被 DSH 沙箱限制，出不了网（git ls-remote 直接失败），
       所以最后的 push 只能由你在自己的终端里执行。

  脚本做四件事：把 <你> / LICENSE 里的占位符换成你的用户名 → 校验 git 身份 →
  本地提交 → 打印（或执行）推送命令。

.PARAMETER GitHubUser
  你的 GitHub 用户名。用于替换 README 里的 <你> 和 LICENSE 的版权行。

.PARAMETER RepoName
  GitHub 上的仓库名，默认 dsh-chimes。

.PARAMETER AuthorName / AuthorEmail
  提交署名。不给就用全局 git 配置；全局也没配会提示你先设置。

.PARAMETER Push
  加上它就顺手执行 git remote add + git push（需要你先在 GitHub 建好空仓库）。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\publish.ps1 -GitHubUser yourname

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\publish.ps1 -GitHubUser yourname -Push
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$GitHubUser,
  [string]$RepoName = 'dsh-chimes',
  [string]$AuthorName = '',
  [string]$AuthorEmail = '',
  [switch]$Push
)

$ErrorActionPreference = 'Stop'
function Info($m) { Write-Host "[*] $m" }
function Ok($m)   { Write-Host "[+] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[!] $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "[x] $m" -ForegroundColor Red; exit 1 }

# 这些文件里含中文，写回时必须保持 UTF-8 带 BOM（否则 PowerShell 5.1 读不了 .ps1；
# 而 Markdown 无所谓）。统一用无 BOM 写正文，脚本自身由仓库里的 BOM 保证。
function Write-Utf8NoBom([string]$Path, [string]$Text) {
  [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding $false))
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
if (-not (Test-Path (Join-Path $repoRoot 'package.json'))) { Die "在 $repoRoot 找不到 package.json" }
if (-not (Test-Path (Join-Path $repoRoot '.git'))) { Die '这不是一个 git 仓库。先在仓库根目录执行 git init -b main。' }

Write-Output "===== 1) 替换占位符为 $GitHubUser ====="
$targets = @('LICENSE', 'README.md', 'README.zh.md', 'SECURITY.md')
foreach ($name in $targets) {
  $path = Join-Path $repoRoot $name
  if (-not (Test-Path $path)) { continue }
  $text = Get-Content $path -Raw -Encoding utf8
  $before = $text
  $text = $text.Replace('<请填写：你的名字或 GitHub 用户名>', $GitHubUser)
  $text = $text.Replace('<你>', $GitHubUser)
  $text = $text.Replace('<you>', $GitHubUser)
  if ($text -ne $before) { Write-Utf8NoBom $path $text; Ok "$name 已更新" }
  else { Info "$name 无需改动" }
}

Write-Output "`n===== 2) 校验 git 身份 ====="
if ($AuthorName)  { & git config --local user.name  $AuthorName }
if ($AuthorEmail) { & git config --local user.email $AuthorEmail }
$name = & git config user.name
$email = & git config user.email
if (-not $name -or -not $email) {
  Warn '还没有 git 提交署名。请先执行（把值换成你自己的）：'
  Write-Host '    git config --local user.name  "Your Name"'
  Write-Host '    git config --local user.email "you@example.com"'
  Write-Host '  或者带参数重跑：-AuthorName "Your Name" -AuthorEmail you@example.com'
  Die '缺少提交署名，已停止（占位符替换已完成，可安全重跑）。'
}
Ok "提交署名：$name <$email>"

Write-Output "`n===== 3) 检查将要提交的内容 ====="
& git add -A
$staged = & git ls-files
Write-Output "  文件数：$(($staged | Measure-Object).Count)"
foreach ($forbidden in @('assets/chime.wav', 'assets/success.wav')) {
  if ($staged -contains $forbidden) { Die "$forbidden 会被提交！它是个人音效，先修 .gitignore 再继续。" }
}
Ok '个人音效已被 .gitignore 排除（不会被公开）'

Write-Output "`n===== 4) 本地提交 ====="
& git commit -q -m "dsh-chimes 1.0.0: startup and completion chimes with an in-app control panel and sound library"
if ($LASTEXITCODE -ne 0) { Warn '提交可能已存在（没有新改动），继续。' } else { Ok '已提交' }

Write-Output "`n===== 5) 接下来 ====="
$remote = "https://github.com/$GitHubUser/$RepoName.git"
if (-not $Push) {
  Write-Host '  先在 GitHub 建一个**空的**仓库（不要勾选 README / .gitignore / license），然后执行：'
  Write-Host ''
  Write-Host "    git remote add origin $remote"
  Write-Host '    git push -u origin main'
  Write-Host ''
  Write-Host '  或者直接带 -Push 重跑本脚本，让它代你执行上面两条。'
  exit 0
}

Write-Output "  推送目标：$remote"
$existing = & git remote
if ($existing -notcontains 'origin') { & git remote add origin $remote } else { & git remote set-url origin $remote }
& git push -u origin main
if ($LASTEXITCODE -ne 0) {
  Warn '推送失败。常见原因：仓库还没建、仓库非空、或凭据未配置（可先跑一次 git push 让 Git 弹出登录窗口）。'
  exit 1
}
Ok '推送完成'
Write-Host ''
Write-Host '  建议顺手做的两件事（提高被发现概率）：'
Write-Host '    · 仓库 About 里填描述 + 加话题：dsh-plugin deepseek-harness cordis windows chime'
Write-Host '    · 建一个 Release（tag v1.0.0），GitHub 会生成 zip 源码包'
