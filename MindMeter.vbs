' Double-click entry: starts MindMeter without a console window.
Option Explicit
Dim shell, fso, root, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root
command = "cmd /c cd /d """ & root & """ && set ""PYTHONPATH=" & root & "\code"" && start """" pythonw -m desktop.launcher"
shell.Run command, 0, False
