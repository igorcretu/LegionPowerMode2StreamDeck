# Elevated helper for the Legion Power Mode StreamDock plugin.
# Runs via a Scheduled Task (RunLevel = Highest) and exposes the
# LENOVO_GAMEZONE_DATA WMI power-mode interface over a named pipe,
# so the non-elevated plugin process never has to touch WMI directly.
#
# Protocol (one line in, one line out, per connection):
#   "GET"       -> "OK <1|2|3>" | "ERR <message>"
#   "SET <n>"   -> "OK"         | "ERR <message>"
# where 1=Quiet, 2=Balance, 3=Performance (LENOVO_GAMEZONE_DATA convention).

$ErrorActionPreference = 'Stop'
$PipeName = 'igorcretu-legion-powermode'

function Get-GameZoneInstance {
    return Get-CimInstance -Namespace 'root\WMI' -ClassName 'LENOVO_GAMEZONE_DATA'
}

function Get-PowerMode {
    $instance = Get-GameZoneInstance
    $result = Invoke-CimMethod -InputObject $instance -MethodName 'GetSmartFanMode'
    return [int]$result.Data
}

function Set-PowerMode([int]$Mode) {
    $instance = Get-GameZoneInstance
    Invoke-CimMethod -InputObject $instance -MethodName 'SetSmartFanMode' -Arguments @{ Data = $Mode } | Out-Null
}

function Handle-Command([string]$Line) {
    $Line = $Line.Trim()
    try {
        if ($Line -eq 'GET') {
            return "OK $(Get-PowerMode)"
        }
        if ($Line -match '^SET (\d)$') {
            Set-PowerMode ([int]$Matches[1])
            return 'OK'
        }
        return "ERR unknown command: $Line"
    } catch {
        return "ERR $($_.Exception.Message)"
    }
}

# The helper runs elevated (High integrity). Named pipes it creates default to a
# DACL that non-elevated processes of the SAME user cannot connect to (Windows
# Mandatory Integrity Control), so grant Authenticated Users explicit ReadWrite —
# same approach Lenovo Legion Toolkit's own IPC server uses for its pipe.
$identity = New-Object System.Security.Principal.SecurityIdentifier([System.Security.Principal.WellKnownSidType]::AuthenticatedUserSid, $null)
$pipeSecurity = New-Object System.IO.Pipes.PipeSecurity
$pipeSecurity.AddAccessRule((New-Object System.IO.Pipes.PipeAccessRule($identity, [System.IO.Pipes.PipeAccessRights]::ReadWrite, [System.Security.AccessControl.AccessControlType]::Allow)))

while ($true) {
    $pipe = New-Object System.IO.Pipes.NamedPipeServerStream(
        $PipeName, [System.IO.Pipes.PipeDirection]::InOut, 1,
        [System.IO.Pipes.PipeTransmissionMode]::Byte, [System.IO.Pipes.PipeOptions]::Asynchronous,
        0, 0, $pipeSecurity)
    try {
        $pipe.WaitForConnection()
        $reader = New-Object System.IO.StreamReader($pipe)
        $writer = New-Object System.IO.StreamWriter($pipe)
        $writer.AutoFlush = $true

        $line = $reader.ReadLine()
        if ($null -ne $line) {
            $response = Handle-Command $line
            $writer.WriteLine($response)
        }
    } catch {
        # Client went away mid-request or similar transient pipe error — just move on.
    } finally {
        $pipe.Dispose()
    }
}
