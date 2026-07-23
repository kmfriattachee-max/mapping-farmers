# PowerShell helper to initialize, commit and push this project to GitHub.
# Run this locally from the project folder after installing Git.

param(
    [string]$RemoteUrl = 'https://github.com/kmfriattachee-max/KMFRI-GIS.git',
    [string]$Branch = 'main'
)

Write-Host "Running from: $(Get-Location)" -ForegroundColor Cyan

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Error "Git is not installed or not on PATH. Install Git for Windows and reopen PowerShell."
    exit 1
}

git init
git add .
$msg = Get-Content COMMIT_MSG.txt -Raw
if (-not $msg) { $msg = 'Initial commit' }
git commit -m $msg

try {
    git remote add origin $RemoteUrl
} catch {
    Write-Host "Remote 'origin' may already exist; updating remote URL." -ForegroundColor Yellow
    git remote set-url origin $RemoteUrl
}

git branch -M $Branch
git push -u origin $Branch

Write-Host "Done. Repository pushed to $RemoteUrl" -ForegroundColor Green