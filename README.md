# ⚡ LegionPowerMode2StreamDeck

Cycle your Lenovo Legion laptop's power mode — **Quiet → Balance → Performance** — with a single key press, straight from your dock. No Lenovo Vantage. No Lenovo Legion Toolkit. Not even installed.

A plugin for [StreamDock](https://www.hotspottek.com/) (Ajazz/Mirabox) that talks to the same firmware interface Lenovo's own apps use, directly.

---

## Why this exists

Every Lenovo power-mode tool — Vantage, Legion Toolkit, the Fn+Q on-screen display — is ultimately a thin wrapper around one WMI class Lenovo ships in firmware: `LENOVO_GAMEZONE_DATA`. This plugin calls that interface itself instead of shelling out to a third-party app's CLI, which means:

- **Zero dependency on Lenovo Legion Toolkit.** Don't want it installed, don't want it running in the background, don't want its CLI integration toggled on? You don't need any of it.
- **No polling a foreign process.** The old approach spawned an external executable on every check; this one talks to a tiny purpose-built helper over a local named pipe — lighter, and one less moving part to break when someone else's app updates.
- **Self-healing.** If the helper isn't running when a request comes in, the plugin quietly relaunches it and retries. You don't do anything.

---

## What you get

A single key that always shows the truth:

| State | Icon | Meaning |
|---|---|---|
| 🔵 **Quiet** | blue bolt, 1 bar | Fans low, thermals relaxed |
| 🟢 **Balance** | green bolt, 2 bars | The everyday middle ground |
| 🟠 **Performance** | orange bolt, 3 bars | Full send |
| ⚪ **Connecting** | slate ring | Polling the laptop right after the key appears |
| 🟡 **Setup needed** | amber gear | The one-time helper install hasn't run yet (see below) |
| 🔴 **Error** | red triangle | Something's actually wrong — check the helper task |

Press the key and it cycles to the next mode immediately, then confirms (or reverts, with an alert) once the hardware actually responds. It also polls quietly in the background, so if you change modes some other way, the key catches up on its own.

---

## Requirements

- A Lenovo Legion laptop (or any Lenovo model exposing `LENOVO_GAMEZONE_DATA` — most gaming-oriented Legion/IdeaPad Gaming/LOQ models do)
- Windows, with your account in the local **Administrators** group (needed once, for setup — see below)
- [Ajazz/Mirabox StreamDock](https://www.hotspottek.com/) software

---

## Installation

1. Download or clone this repo
2. Copy the `com.igorcretu.legion.powermode.sdPlugin` folder into your StreamDock plugins directory:

   ```text
   %APPDATA%\HotSpot\StreamDock\plugins\
   ```

3. **Run the one-time setup** (see below) — this is the only manual step
4. Restart StreamDock
5. The **Legion Power Mode** action will appear in the action list

### One-time setup (~10 seconds, one UAC prompt)

Reading and writing `LENOVO_GAMEZONE_DATA` requires administrator privileges — that's true whether Lenovo's own apps do it or this plugin does. Rather than asking Windows for permission on every single press, this plugin sets up a tiny **elevated helper** once, and reuses it silently forever after.

Right-click `helper/install-task.ps1` → **Run with PowerShell as Administrator** (or run it from an elevated prompt). It will:

1. Register a Windows Scheduled Task that runs `helper.ps1` with the "Run with highest privileges" flag
2. Start it immediately

That's the only elevated step, ever. From then on:

- The helper sits quietly listening on a local named pipe (`\\.\pipe\igorcretu-legion-powermode`)
- The (non-elevated) StreamDock plugin talks to it over that pipe for every get/set
- If the helper isn't running for any reason, the plugin silently re-triggers the scheduled task — and because it's already registered with "highest privileges," Windows launches it elevated **without another prompt**

If you skip this step, the key shows the amber gear icon instead of failing mysteriously, so it's obvious what to do.

---

## How it works

```
StreamDock  ──WebSocket──▶  plugin/index.js  ──named pipe──▶  helper/helper.ps1  ──WMI──▶  LENOVO_GAMEZONE_DATA
 (unprivileged)                                                (elevated, via                (root\WMI, firmware-
                                                                 Scheduled Task)                 exposed interface)
```

- `plugin/index.js` is a small Node process (StreamDock's own bundled Node 20 runtime) that speaks the StreamDock WebSocket protocol and forwards `GET`/`SET <mode>` commands over the pipe.
- `helper/helper.ps1` is the only piece of this that ever touches WMI. It calls `Get-CimInstance` / `Invoke-CimMethod` against `LENOVO_GAMEZONE_DATA`'s `GetSmartFanMode` / `SetSmartFanMode` methods — the exact same calls Lenovo's own software makes — and exposes the result over a named pipe with an ACL that allows your normal, non-elevated session to connect to it.
- Mode values follow Lenovo's own convention: `1 = Quiet`, `2 = Balance`, `3 = Performance`.

---

## Troubleshooting

- **Stuck on the amber gear** → the scheduled task isn't installed. Run `helper/install-task.ps1` as Administrator.
- **Stuck on the red triangle** → the task exists but something's failing repeatedly. Open Task Scheduler, find `IgorCretu-LegionPowerModeHelper`, check its last run result, and confirm your laptop actually exposes `LENOVO_GAMEZONE_DATA` (`Get-CimInstance -Namespace root\WMI -ClassName LENOVO_GAMEZONE_DATA` from an elevated PowerShell should return data, not an error).
- **Moved the plugin folder to a new path** → re-run `install-task.ps1`; the task's action points at the folder it was installed from.

---

## License

MIT
