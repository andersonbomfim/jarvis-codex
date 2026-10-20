using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

// Presentation belongs to Usuário's interactive desktop, never SYSTEM/Winlogon.
public static class JarvisWindow {
    delegate bool EnumProc(IntPtr hwnd, IntPtr arg);
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct MonitorInfo { public int Size; public Rect Monitor, Work; public uint Flags; }
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr arg);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int w, int h, uint flags);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr hwnd, int index, int value);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool GetUserObjectInformation(IntPtr obj, int index, StringBuilder name, int length, out int needed);
    [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    public static bool CloseForUpdate(IntPtr hwnd) {
        if (!DesktopAvailable()) return false;
        return PostMessage(hwnd, 0x0010, IntPtr.Zero, IntPtr.Zero);
    }

    public static bool DesktopAvailable() {
        IntPtr desktop = OpenInputDesktop(0, false, 1);
        if (desktop == IntPtr.Zero) return false;
        try {
            int needed; var name = new StringBuilder(256);
            return GetUserObjectInformation(desktop, 2, name, 512, out needed) && name.ToString() == "Default";
        } finally { CloseDesktop(desktop); }
    }
    public static IntPtr Find(uint[] processIds) {
        var allowed = new HashSet<uint>(processIds); IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr hwnd, IntPtr arg) {
            uint pid; GetWindowThreadProcessId(hwnd, out pid);
            if (!allowed.Contains(pid) || !IsWindowVisible(hwnd)) return true;
            var title = new StringBuilder(512); GetWindowText(hwnd, title, 512);
            string name = title.ToString().Replace(".", "").Replace(" · ", "").ToUpperInvariant();
            if (!name.Contains("JARVIS")) return true;
            found = hwnd; return false;
        }, IntPtr.Zero);
        return found;
    }
    public class Result {
        public long Handle; public bool Foreground, Fullscreen, Topmost;
        public int Width, Height;
    }
    public static Result Present(IntPtr hwnd) {
        if (!DesktopAvailable()) throw new InvalidOperationException("Sessão bloqueada ou desktop indisponível.");
        ShowWindow(hwnd, 9);
        var info = new MonitorInfo(); info.Size = Marshal.SizeOf(typeof(MonitorInfo));
        if (!GetMonitorInfo(MonitorFromWindow(hwnd, 2), ref info)) throw new InvalidOperationException("Monitor indisponível.");
        // Borderless fullscreen only for the dedicated Jarvis window. Alt+Tab/Alt+F4 remain normal.
        int style = GetWindowLong(hwnd, -16);
        SetWindowLong(hwnd, -16, style & ~0x00C40000);
        uint owner; uint foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), out owner);
        uint thread = GetCurrentThreadId(); bool attached = false;
        try {
            if (foregroundThread != 0 && foregroundThread != thread) attached = AttachThreadInput(thread, foregroundThread, true);
            SetWindowPos(hwnd, new IntPtr(-1), info.Monitor.Left, info.Monitor.Top,
                info.Monitor.Right-info.Monitor.Left, info.Monitor.Bottom-info.Monitor.Top, 0x0060);
            SetForegroundWindow(hwnd);
        } finally {
            // Do not leave Jarvis permanently above the user's other applications.
            SetWindowPos(hwnd, new IntPtr(-2), 0, 0, 0, 0, 0x0013);
            if (attached) AttachThreadInput(thread, foregroundThread, false);
        }
        Rect rect; GetWindowRect(hwnd, out rect);
        return new Result { Handle=hwnd.ToInt64(), Foreground=GetForegroundWindow()==hwnd,
            Fullscreen=rect.Left==info.Monitor.Left && rect.Top==info.Monitor.Top && rect.Right==info.Monitor.Right && rect.Bottom==info.Monitor.Bottom,
            Topmost=(GetWindowLong(hwnd, -20) & 8)!=0, Width=rect.Right-rect.Left, Height=rect.Bottom-rect.Top };
    }
}
