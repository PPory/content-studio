' Hidden launcher. The Start Menu shortcut points here, not at launch.ps1.
'
' Why the extra hop: a shortcut to powershell.exe flashes a console window for a
' fraction of a second even with -WindowStyle Hidden -- the window is created,
' then hidden. wscript.exe creates none at all. That flash is the difference
' between "this is an app" and "this is a script someone wrapped".
'
' Keep this file ASCII-only: wscript reads .vbs as ANSI unless it is UTF-16,
' so any Chinese here would come back as garbage.

Option Explicit

Dim shell, here, cmd
Set shell = CreateObject("WScript.Shell")
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))

cmd = "powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & here & "launch.ps1"""
shell.Run cmd, 0, False
