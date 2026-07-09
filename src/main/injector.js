// Injects text into the focused app: clipboard + simulated Ctrl+V (Ctrl+Shift+V
// for terminals). Also reports the foreground app so dictations can be tagged
// and toned per app. Uses a persistent PowerShell helper with Win32 SendInput —
// no native npm modules, no per-paste process spawn latency.
'use strict';
const { spawn } = require('child_process');
const { clipboard } = require('electron');

const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class VaaniInjector {
    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)]
    struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)]
    struct INPUT { public uint type; public InputUnion U; }

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
    [DllImport("user32.dll")]
    static extern short GetAsyncKeyState(int vKey);
    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder sb, int max);

    const uint INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_KEYUP = 0x0002;

    static INPUT Key(ushort vk, bool up) {
        var inp = new INPUT { type = INPUT_KEYBOARD };
        inp.U.ki = new KEYBDINPUT { wVk = vk, dwFlags = up ? KEYEVENTF_KEYUP : 0 };
        return inp;
    }

    static void Send(INPUT[] inputs) {
        SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    }

    // Release any modifiers the user may still be physically holding (hotkey keys),
    // so the injected Ctrl+V is not turned into Ctrl+Win+V etc.
    public static void ReleaseModifiers() {
        ushort[] mods = { 0x10, 0x11, 0x12, 0x5B, 0x5C, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5 };
        foreach (var vk in mods) {
            if ((GetAsyncKeyState(vk) & 0x8000) != 0) Send(new[] { Key(vk, true) });
        }
        Thread.Sleep(25);
    }

    public static void Paste() {
        ReleaseModifiers();
        Send(new[] { Key(0x11, false), Key(0x56, false), Key(0x56, true), Key(0x11, true) });
    }

    public static void PasteShift() {
        ReleaseModifiers();
        Send(new[] { Key(0x11, false), Key(0x10, false), Key(0x56, false), Key(0x56, true), Key(0x10, true), Key(0x11, true) });
    }

    public static void Backspace() {
        ReleaseModifiers();
        Send(new[] { Key(0x08, false), Key(0x08, true) });
        Thread.Sleep(15);
    }

    public static string ForegroundInfo() {
        var h = GetForegroundWindow();
        if (h == IntPtr.Zero) return "";
        uint pid;
        GetWindowThreadProcessId(h, out pid);
        var sb = new System.Text.StringBuilder(512);
        GetWindowText(h, sb, 512);
        return pid.ToString() + "|" + sb.ToString().Replace("\\n", " ").Replace("\\r", " ");
    }
}
"@

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $reply = 'ok'
    try {
        switch ($line.Trim()) {
            'ping'    { }
            'paste'   { [VaaniInjector]::Paste() }
            'pastesh' { [VaaniInjector]::PasteShift() }
            'bs'      { [VaaniInjector]::Backspace() }
            'fg'      {
                $info = [VaaniInjector]::ForegroundInfo()
                $app = ''; $title = ''
                if ($info) {
                    $parts = $info.Split('|', 2)
                    $title = $parts[1]
                    try { $app = [System.Diagnostics.Process]::GetProcessById([int]$parts[0]).ProcessName } catch {}
                }
                $reply = 'ok ' + (@{ app = $app; title = $title } | ConvertTo-Json -Compress)
            }
        }
    } catch {
        $reply = 'err ' + $_.Exception.Message
    }
    [Console]::Out.WriteLine($reply)
    [Console]::Out.Flush()
}
`;

// process names that need Ctrl+Shift+V instead of Ctrl+V
const TERMINAL_APPS = new Set([
  'windowsterminal', 'openconsole', 'cmd', 'conhost', 'powershell', 'pwsh',
  'alacritty', 'wezterm', 'wezterm-gui', 'hyper', 'mintty', 'kitty', 'tabby', 'terminus'
]);

class Injector {
  constructor() {
    this.proc = null;
    this.queue = []; // pending { resolve, timer }
    this.buffer = '';
  }

  start() {
    if (this.proc) return;
    const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
    this.proc = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded
    ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

    this.proc.stdout.on('data', (d) => {
      this.buffer += d.toString();
      let nl;
      while ((nl = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        const pending = this.queue.shift();
        if (pending) {
          clearTimeout(pending.timer);
          if (line === 'ok' || line.startsWith('ok ')) {
            pending.resolve({ ok: true, payload: line.length > 3 ? line.slice(3) : null });
          } else {
            pending.resolve({ ok: false, message: line });
          }
        }
      }
    });
    this.proc.stderr.on('data', (d) => {
      const s = d.toString();
      if (s.startsWith('#< CLIXML')) return; // PowerShell's non-interactive stderr preamble, not an error
      console.error('injector stderr:', s.slice(0, 300));
    });
    this.proc.on('exit', (code) => {
      console.error('injector helper exited', code);
      this.proc = null;
      while (this.queue.length) {
        const p = this.queue.shift();
        clearTimeout(p.timer);
        p.resolve({ ok: false, message: 'helper exited' });
      }
    });
  }

  _send(cmd, timeoutMs = 5000) {
    this.start();
    if (!this.proc) return Promise.resolve({ ok: false, message: 'helper unavailable' });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const i = this.queue.findIndex((p) => p.resolve === resolve);
        if (i >= 0) this.queue.splice(i, 1);
        resolve({ ok: false, message: 'helper timed out' });
      }, timeoutMs);
      this.queue.push({ resolve, timer });
      this.proc.stdin.write(cmd + '\n');
    });
  }

  // Warm-up: Add-Type compilation happens on first command; do it at app start.
  ping() {
    return this._send('ping', 15000);
  }

  // { app: 'Code', title: 'main.js — vaaniflow' } for the focused window, or null
  async foreground() {
    const r = await this._send('fg', 3000);
    if (!r.ok || !r.payload) return null;
    try {
      const info = JSON.parse(r.payload);
      return { app: String(info.app || ''), title: String(info.title || '') };
    } catch {
      return null;
    }
  }

  isTerminalApp(appInfo) {
    return !!appInfo && TERMINAL_APPS.has(String(appInfo.app || '').toLowerCase());
  }

  async pasteText(text, { backspaceFirst = false, restoreClipboard = false, shiftPaste = false } = {}) {
    const previous = restoreClipboard ? clipboard.readText() : null;
    clipboard.writeText(text);
    // Give the clipboard a beat to settle before the paste keystroke.
    await new Promise((r) => setTimeout(r, 50));
    if (backspaceFirst) await this._send('bs');
    const result = await this._send(shiftPaste ? 'pastesh' : 'paste');
    if (restoreClipboard) {
      setTimeout(() => {
        // don't clobber something the user copied in the meantime
        try { if (clipboard.readText() === text) clipboard.writeText(previous); } catch {}
      }, 1500);
    }
    return result;
  }

  stop() {
    if (this.proc) {
      try { this.proc.stdin.end(); this.proc.kill(); } catch {}
      this.proc = null;
    }
  }
}

module.exports = { Injector };
