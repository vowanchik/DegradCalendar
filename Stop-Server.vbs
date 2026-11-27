Option Explicit
Dim shell, files, root, command, result
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & root & "\scripts\server-windows.ps1"" -Action Stop"
result = shell.Run(command, 0, True)
If result <> 0 Then MsgBox "PartyUp server could not stop. Run scripts\server-windows.ps1 -Action Status in PowerShell.", 16, "PartyUp"
WScript.Quit result
