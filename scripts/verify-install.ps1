param([ValidateSet('install','check','uninstall')][string]$Action = 'install')
$ErrorActionPreference = 'Stop'
$projectDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testDirectory = [IO.Path]::GetFullPath((Join-Path $projectDirectory 'test-artifacts\installed'))
if (-not $testDirectory.StartsWith($projectDirectory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Test directory must stay inside the project.' }
$installerPath = Join-Path $projectDirectory 'dist\URLChecker-Setup-1.2.0.exe'
$applicationPath = Join-Path $testDirectory 'URL Checker Pro.exe'
$getRegistration = { Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'URL Checker Pro*' } }
$registration = & $getRegistration
if ($Action -ne 'uninstall') {
  $installerExitCode = $null
  if ($Action -eq 'install') {
  if ($registration) { throw 'An existing URL Checker Pro installation was found; this test will not replace it.' }
  New-Item -ItemType Directory -Path $testDirectory -Force | Out-Null
  $process = Start-Process -FilePath $installerPath -ArgumentList @('/S', "/D=$testDirectory") -WindowStyle Hidden -PassThru -Wait
  if ($process.ExitCode -ne 0) { throw "Installer exited with $($process.ExitCode)." }
  $installerExitCode = $process.ExitCode
  }
  if (-not (Test-Path -LiteralPath $applicationPath)) { throw 'Installed executable is missing.' }
  $registration = & $getRegistration
  if (-not $registration) { throw 'Installed Apps registration is missing.' }
  $desktopDirectory = [Environment]::GetFolderPath('DesktopDirectory')
  $programsDirectory = [Environment]::GetFolderPath('Programs')
  $desktopShortcut = Get-ChildItem -LiteralPath $desktopDirectory -Filter 'URL Checker Pro.lnk' -ErrorAction SilentlyContinue
  $menuShortcut = Get-ChildItem -LiteralPath $programsDirectory -Filter 'URL Checker Pro.lnk' -Recurse -ErrorAction SilentlyContinue
  if (-not $desktopShortcut -or -not $menuShortcut) { throw 'Expected desktop and Start Menu shortcuts.' }
  [PSCustomObject]@{ InstallerExitCode=$installerExitCode; Application=$applicationPath; ProductVersion=(Get-Item -LiteralPath $applicationPath).VersionInfo.ProductVersion; DisplayName=$registration.DisplayName; Publisher=$registration.Publisher; UninstallString=$registration.UninstallString; DesktopShortcut=$desktopShortcut.FullName; StartMenuShortcut=$menuShortcut.FullName } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $projectDirectory 'test-artifacts\install-verification.json')
  Get-Content -LiteralPath (Join-Path $projectDirectory 'test-artifacts\install-verification.json')
} else {
  $uninstallerPath = Join-Path $testDirectory 'Uninstall URL Checker Pro.exe'
  if (-not (Test-Path -LiteralPath $uninstallerPath)) { throw 'Expected test uninstaller is missing.' }
  if ($registration -and -not $registration.UninstallString.StartsWith('"' + $uninstallerPath + '"', [StringComparison]::OrdinalIgnoreCase)) { throw 'Registration points outside the test installation.' }
  $process = Start-Process -FilePath $uninstallerPath -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
  if ($process.ExitCode -ne 0) { throw "Uninstaller exited with $($process.ExitCode)." }
  if (& $getRegistration) { throw 'Installed Apps registration remains after uninstall.' }
  if (Test-Path -LiteralPath $applicationPath) { throw 'Application executable remains after uninstall.' }
  'Uninstall verified: executable and Installed Apps registration removed.'
}
