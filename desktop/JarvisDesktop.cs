using System;
using System.IO;
using System.Drawing;
using System.Diagnostics;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

// The desktop owns only its own WebView and the Jarvis service launcher.
internal sealed class JarvisDesktop : Form {
    readonly string root, statePath;
    readonly WebView2 view = new WebView2();
    readonly System.Windows.Forms.Timer health = new System.Windows.Forms.Timer();
    readonly HttpClient http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
    readonly bool capture;
    bool checking, closing, ready, fullscreen = true;
    int failures;
    string lastError = "", currentUrl = "";
    DateTime lastLaunch = DateTime.MinValue;
    [DllImport("shell32.dll")] static extern int SetCurrentProcessExplicitAppUserModelID([MarshalAs(UnmanagedType.LPWStr)] string id);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);

    [STAThread] static void Main(string[] args) {
        bool created;
        using (var single = new Mutex(true, "Local\\JarvisCommunityDesktop", out created))
        using (var activate = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\JarvisCommunityDesktopActivate")) {
            if (!created) { activate.Set(); return; }
            SetCurrentProcessExplicitAppUserModelID("Community.Jarvis.Desktop");
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            string project = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", ".."));
            using (var app = new JarvisDesktop(project, Array.IndexOf(args, "--capture-proof") >= 0)) {
                // Explicit local diagnostic only: emulate closing this form, never stop services or another app.
                System.Windows.Forms.Timer closeTest = null;
                if (Array.IndexOf(args, "--diagnostic-close-after-eight-seconds") >= 0) {
                    closeTest = new System.Windows.Forms.Timer { Interval = 8000 };
                    closeTest.Tick += delegate { closeTest.Stop(); app.WindowKeyDown(app, new KeyEventArgs(Keys.Escape)); };
                    app.Shown += delegate { closeTest.Start(); };
                }
                var wait = ThreadPool.RegisterWaitForSingleObject(activate, delegate(object obj, bool timedOut) {
                    if (!app.IsDisposed && app.IsHandleCreated) try { app.BeginInvoke((Action)app.Present); } catch (InvalidOperationException) {}
                }, null, Timeout.Infinite, false);
                Application.Run(app);
                if (closeTest != null) closeTest.Dispose();
                wait.Unregister(null);
            }
            single.ReleaseMutex();
        }
    }
    JarvisDesktop(string project, bool proof) {
        root = project; capture = proof;
        statePath = Path.Combine(root, ".local", "desktop", "status.json");
        Text = "J.A.R.V.I.S."; BackColor = Color.FromArgb(2, 8, 10);
        Icon = new Icon(Path.Combine(root, "public", "favicon.ico"));
        FormBorderStyle = FormBorderStyle.None; WindowState = FormWindowState.Maximized;
        MinimumSize = new Size(900, 600); KeyPreview = true;
        view.Dock = DockStyle.Fill; view.DefaultBackgroundColor = BackColor; Controls.Add(view);
        Shown += async delegate { await Initialize(); };
        FormClosing += delegate { closing = true; health.Stop(); Record("closed"); };
        FormClosed += delegate { http.Dispose(); health.Dispose(); };
        KeyDown += WindowKeyDown;
        view.KeyDown += WindowKeyDown;
        health.Interval = 30000; health.Tick += async delegate { await CheckServices(); }; health.Start();
        Record("starting");
    }
    void Present() { if (closing) return; WindowState = FormWindowState.Maximized; Show(); Activate(); SetForegroundWindow(Handle); }
    void WindowKeyDown(object sender, KeyEventArgs e) {
        if (e.KeyCode != Keys.Escape && e.KeyCode != Keys.F11) return;
        e.Handled = true; e.SuppressKeyPress = true;
        // WebView blocks its browser process during accelerator events; close asynchronously.
        if (e.KeyCode == Keys.Escape) RequestClose();
        else if (!closing) BeginInvoke((Action)ToggleFullscreen);
    }
    void RequestClose() { if (!closing && !IsDisposed && IsHandleCreated) BeginInvoke((Action)delegate { if (!closing) Close(); }); }
    void ToggleFullscreen() {
        fullscreen = !fullscreen;
        WindowState = FormWindowState.Normal;
        FormBorderStyle = fullscreen ? FormBorderStyle.None : FormBorderStyle.Sizable;
        WindowState = FormWindowState.Maximized;
    }
    void Record(string status) {
        try {
            Directory.CreateDirectory(Path.GetDirectoryName(statePath));
            var data = new { status, at = DateTimeOffset.Now.ToString("o"), pid = Process.GetCurrentProcess().Id, engine = "WebView2", url = currentUrl, navigationSucceeded = ready, error = lastError, textOnly = !VoiceEnabled(), wallpaperProcesses = WallpaperSnapshot() };
            string temp = statePath + ".tmp";
            string serialized = new JavaScriptSerializer().Serialize(data);
            File.WriteAllText(temp, serialized);
            if (File.Exists(statePath)) File.Replace(temp, statePath, null); else File.Move(temp, statePath);
            File.AppendAllText(Path.Combine(root, ".local", "desktop", "lifecycle.jsonl"), serialized + Environment.NewLine);
        } catch (IOException) {}
    }
    object[] WallpaperSnapshot() {
        var found = new System.Collections.Generic.List<object>();
        foreach (string name in new string[] { "wallpaper64", "wallpaper32" }) {
            foreach (var process in Process.GetProcessesByName(name)) {
                using (process) try { found.Add(new { pid = process.Id, name = process.ProcessName, startedAt = process.StartTime.ToUniversalTime().ToString("o") }); } catch (InvalidOperationException) {} catch (System.ComponentModel.Win32Exception) {}
            }
        }
        return found.ToArray();
    }
    bool VoiceEnabled() {
        try {
            var data = new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string, object>>(File.ReadAllText(Path.Combine(root, ".local", "desktop-settings.json")));
            return data.ContainsKey("voiceEnabled") && Object.Equals(data["voiceEnabled"], true);
        } catch { return false; }
    }
    string AppUrl() { return "http://127.0.0.1:5173/?desktop=1&morning=1" + (VoiceEnabled() ? "&auto=1" : "&text=1"); }
    async Task Initialize() {
        try {
            var options = new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required");
            options.Language = "pt-BR";
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(root, ".local", "desktop-profile"), options);
            await view.EnsureCoreWebView2Async(env);
            view.CoreWebView2.Settings.IsStatusBarEnabled = false;
            view.CoreWebView2.Settings.AreDevToolsEnabled = false;
            view.CoreWebView2.WebMessageReceived += delegate(object sender, CoreWebView2WebMessageReceivedEventArgs e) {
                Uri source;
                if (!Uri.TryCreate(e.Source, UriKind.Absolute, out source) || source.Scheme != "http" || source.Host != "127.0.0.1" || source.Port != 5173 || source.AbsolutePath != "/") return;
                try { if (e.TryGetWebMessageAsString() == "jarvis:close") RequestClose(); }
                catch (ArgumentException) { /* Ignore structured or unrelated page messages. */ }
            };
            view.CoreWebView2.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e) {
                Uri target;
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out target) || target.Scheme != "http" || target.Host != "127.0.0.1" || target.Port != 5173) {
                    e.Cancel = true;
                    if (e.IsUserInitiated) OpenExternal(e.Uri);
                }
            };
            view.CoreWebView2.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e) { e.Handled = true; if (e.IsUserInitiated) OpenExternal(e.Uri); };
            view.CoreWebView2.NavigationCompleted += async delegate(object sender, CoreWebView2NavigationCompletedEventArgs e) {
                ready = e.IsSuccess; currentUrl = view.Source == null ? "" : view.Source.ToString();
                lastError = e.IsSuccess ? "" : e.WebErrorStatus.ToString(); Record(e.IsSuccess ? "ready" : "navigation_failed");
                if (capture && e.IsSuccess) {
                    await Task.Delay(6500);
                    if (!closing && !view.IsDisposed) try {
                        using (var file = File.Create(Path.Combine(root, ".local", "desktop", "preview.png"))) await view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, file);
                    } catch (Exception error) { lastError = error.Message; Record("capture_failed"); }
                }
            };
            view.CoreWebView2.ProcessFailed += async delegate { ready = false; lastError = "WebView process interrupted"; Record("recovering"); await Task.Delay(1500); if (!closing) { try { view.Reload(); } catch { Close(); } } };
            view.Source = new Uri(AppUrl());
        } catch (Exception error) { lastError = error.Message; Record("initialization_failed"); MessageBox.Show(this, "O Jarvis não pôde abrir: " + error.Message, "Jarvis"); }
    }
    static void OpenExternal(string address) {
        Uri uri;
        if (Uri.TryCreate(address, UriKind.Absolute, out uri) && (uri.Scheme == "https" || uri.Scheme == "http")) Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
    }
    async Task CheckServices() {
        if (checking || closing) return;
        checking = true;
        try {
            using (var brain = await http.GetAsync("http://127.0.0.1:8787/health")) brain.EnsureSuccessStatusCode();
            using (var face = await http.GetAsync("http://127.0.0.1:5173/")) face.EnsureSuccessStatusCode();
            if (failures > 0) { failures = 0; lastError = ""; Record(ready ? "ready" : "recovering_view"); }
            if (!ready && view.CoreWebView2 != null) view.Source = new Uri(AppUrl());
        } catch (Exception error) {
            lastError = error.Message;
            if (++failures >= 2 && DateTime.UtcNow - lastLaunch > TimeSpan.FromSeconds(60)) {
                lastLaunch = DateTime.UtcNow; Record("recovering_services");
                Process.Start(new ProcessStartInfo("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -File \"" + Path.Combine(root, "scripts", "Start-Jarvis.ps1") + "\" -NoOpen") { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden, WorkingDirectory = root });
            }
        } finally { checking = false; }
    }
}
