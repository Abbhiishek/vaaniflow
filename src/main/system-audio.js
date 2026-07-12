// Temporarily mutes the Windows default output endpoint while dictation is live.
// The previous mute state is restored on stop, cancellation, app shutdown, or
// when the helper's input stream closes.
'use strict';
const { spawn } = require('child_process');

const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public enum EDataFlow { eRender, eCapture, eAll }
public enum ERole { eConsole, eMultimedia, eCommunications }

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorComObject { }

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(EDataFlow dataFlow, uint stateMask, out IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice endpoint);
    [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
    [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
    [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, uint clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
    [PreserveSig] int OpenPropertyStore(uint access, out IntPtr properties);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetState(out uint state);
}

[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr notify);
    int UnregisterControlChangeNotify(IntPtr notify);
    int GetChannelCount(out uint count);
    int SetMasterVolumeLevel(float levelDb, ref Guid eventContext);
    int SetMasterVolumeLevelScalar(float level, ref Guid eventContext);
    int GetMasterVolumeLevel(out float levelDb);
    int GetMasterVolumeLevelScalar(out float level);
    int SetChannelVolumeLevel(uint channel, float levelDb, ref Guid eventContext);
    int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid eventContext);
    int GetChannelVolumeLevel(uint channel, out float levelDb);
    int GetChannelVolumeLevelScalar(uint channel, out float level);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid eventContext);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    int GetVolumeStepInfo(out uint step, out uint stepCount);
    int VolumeStepUp(ref Guid eventContext);
    int VolumeStepDown(ref Guid eventContext);
    int QueryHardwareSupport(out uint mask);
    int GetVolumeRange(out float minDb, out float maxDb, out float incrementDb);
}

public static class VaaniSystemAudio {
    const uint CLSCTX_ALL = 23;
    static readonly object Sync = new object();
    static bool hasPreviousMute = false;
    static bool previousMute = false;

    static IAudioEndpointVolume Endpoint() {
        var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
        IMMDevice device;
        Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out device));
        Guid iid = typeof(IAudioEndpointVolume).GUID;
        object instance;
        Marshal.ThrowExceptionForHR(device.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out instance));
        return (IAudioEndpointVolume)instance;
    }

    public static bool IsMuted() {
        bool muted;
        Marshal.ThrowExceptionForHR(Endpoint().GetMute(out muted));
        return muted;
    }

    public static void Mute() {
        lock (Sync) {
            var endpoint = Endpoint();
            bool muted;
            Marshal.ThrowExceptionForHR(endpoint.GetMute(out muted));
            if (!hasPreviousMute) {
                previousMute = muted;
                hasPreviousMute = true;
            }
            if (!muted) {
                Guid context = Guid.Empty;
                Marshal.ThrowExceptionForHR(endpoint.SetMute(true, ref context));
            }
        }
    }

    public static void Restore() {
        lock (Sync) {
            if (!hasPreviousMute) return;
            Guid context = Guid.Empty;
            Marshal.ThrowExceptionForHR(Endpoint().SetMute(previousMute, ref context));
            hasPreviousMute = false;
        }
    }
}
"@

try {
    while ($true) {
        $line = [Console]::In.ReadLine()
        if ($null -eq $line) { break }
        $reply = 'ok'
        try {
            switch ($line.Trim()) {
                'ping'    { }
                'status'  { $reply = 'ok ' + ($(if ([VaaniSystemAudio]::IsMuted()) { 'muted' } else { 'unmuted' })) }
                'mute'    { [VaaniSystemAudio]::Mute() }
                'restore' { [VaaniSystemAudio]::Restore() }
            }
        } catch {
            $reply = 'err ' + $_.Exception.Message
        }
        [Console]::Out.WriteLine($reply)
        [Console]::Out.Flush()
    }
} finally {
    try { [VaaniSystemAudio]::Restore() } catch {}
}
`;

class SystemAudioMute {
  constructor() {
    this.proc = null;
    this.queue = [];
    this.buffer = '';
    this.available = process.platform === 'win32';
  }

  start() {
    if (!this.available || this.proc) return;
    const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
    this.proc = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded
    ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

    this.proc.stdout.on('data', (data) => {
      this.buffer += data.toString();
      let newline;
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        const pending = this.queue.shift();
        if (!pending) continue;
        clearTimeout(pending.timer);
        if (line === 'ok' || line.startsWith('ok ')) {
          pending.resolve({ ok: true, payload: line.length > 3 ? line.slice(3) : null });
        } else {
          pending.resolve({ ok: false, message: line.replace(/^err\s*/, '') });
        }
      }
    });
    this.proc.stderr.on('data', (data) => {
      const message = data.toString();
      if (message.startsWith('#< CLIXML') || message.startsWith('<Objs Version=')) return;
      console.error('system audio helper:', message.slice(0, 300));
    });
    this.proc.on('exit', () => {
      this.proc = null;
      while (this.queue.length) {
        const pending = this.queue.shift();
        clearTimeout(pending.timer);
        pending.resolve({ ok: false, message: 'system audio helper exited' });
      }
    });
  }

  _send(command, timeoutMs = 10000) {
    if (!this.available) return Promise.resolve({ ok: false, message: 'System audio muting is only available on Windows.' });
    this.start();
    if (!this.proc) return Promise.resolve({ ok: false, message: 'System audio helper is unavailable.' });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const index = this.queue.findIndex((item) => item.resolve === resolve);
        if (index >= 0) this.queue.splice(index, 1);
        resolve({ ok: false, message: 'system audio helper timed out' });
      }, timeoutMs);
      this.queue.push({ resolve, timer });
      this.proc.stdin.write(command + '\n');
    });
  }

  ping() { return this._send('ping', 15000); }
  status() { return this._send('status', 15000); }
  mute() { return this._send('mute', 15000); }
  restore() { return this._send('restore', 15000); }

  stop() {
    if (!this.proc) return;
    try {
      this.proc.stdin.write('restore\n');
      this.proc.stdin.end();
    } catch {}
  }
}

module.exports = { SystemAudioMute };
