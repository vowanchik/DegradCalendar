Option Explicit
Dim shell, files, root, command, result
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & root & "\scripts\server-windows.ps1"" -Action Start"
result = shell.Run(command, 0, True)
If result <> 0 Then MsgBox "PartyUp server could not start. Run scripts\server-windows.ps1 -Action Start in PowerShell and check logs\server-error.log.", 16, "PartyUp"
WScript.Quit result
