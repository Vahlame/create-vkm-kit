' Launch PowerShell with a script file: no visible console window.
' Usage (Task Scheduler / Run):
'   wscript.exe //nologo "%REPO%\scripts\windows\Run-Hidden.vbs" "%REPO%\scripts\windows\SomeScript.ps1"
If WScript.Arguments.Count < 1 Then WScript.Quit 1
Dim ps1: ps1 = WScript.Arguments(0)
Dim cmd
cmd = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & ps1 & Chr(34)
CreateObject("WScript.Shell").Run cmd, 0, False
