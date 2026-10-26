param([Parameter(Mandatory=$true)][string]$Exe, [string]$Account = '')
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath $Exe -PathType Leaf)) { exit 2 }
if ($Account -and $Account -notmatch '^\d{5,12}$') { exit 3 }
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class WhaleQQWindow {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr param);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint process);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder name, int count);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command);
  [DllImport("kernel32.dll")] public static extern bool AllocConsole();
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
}
'@
# Keep an inherited console hidden, including QQ builds that allocate logging consoles.
[void][WhaleQQWindow]::AllocConsole()
[void][WhaleQQWindow]::ShowWindow([WhaleQQWindow]::GetConsoleWindow(), 0)
$start = New-Object System.Diagnostics.ProcessStartInfo
$start.FileName = $Exe
$start.WorkingDirectory = Split-Path -Path $Exe -Parent
$start.Arguments = $Account
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
$child = [System.Diagnostics.Process]::Start($start)
$owned = New-Object 'System.Collections.Generic.HashSet[uint32]'
[void]$owned.Add([uint32]$child.Id)
$deadline = [DateTime]::UtcNow.AddSeconds(120)
$nextScan = [DateTime]::MinValue
while ([DateTime]::UtcNow -lt $deadline) {
  if ([DateTime]::UtcNow -ge $nextScan) {
    $rows = Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('QQ.exe', 'NapCatWinBootMain.exe') }
    foreach ($row in $rows) { if ($owned.Contains([uint32]$row.ParentProcessId)) { [void]$owned.Add([uint32]$row.ProcessId) } }
    $nextScan = [DateTime]::UtcNow.AddSeconds(2)
  }
  $callback = [WhaleQQWindow+EnumProc]{ param($window, $unused)
    [uint32]$windowOwner = 0
    [void][WhaleQQWindow]::GetWindowThreadProcessId($window, [ref]$windowOwner)
    if ($owned.Contains($windowOwner)) {
      $class = New-Object System.Text.StringBuilder 128
      [void][WhaleQQWindow]::GetClassName($window, $class, 128)
      if ($class.ToString() -eq 'ConsoleWindowClass') { [void][WhaleQQWindow]::ShowWindow($window, 0) }
    }
    return $true
  }
  [void][WhaleQQWindow]::EnumWindows($callback, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 100
}
