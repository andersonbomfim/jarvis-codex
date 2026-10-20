using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Drawing;
using System.Diagnostics;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal sealed class Setup : Form {
    readonly TextBox destination=new TextBox(),name=new TextBox(),city=new TextBox(),zone=new TextBox(),interests=new TextBox(),work=new TextBox(),log=new TextBox();
    readonly CheckBox microphone=new CheckBox();
    readonly Button install=new Button(),login=new Button(),launch=new Button();
    bool busy;
    string installedRoot;
    [STAThread] static int Main(string[] args){
        if(Array.IndexOf(args,"--verify-payload")>=0){try{VerifyPayload();return 0;}catch{return 1;}}
        Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);Application.Run(new Setup());return 0;
    }
    static Stream Payload(){var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("Jarvis.Payload");if(stream==null)throw new IOException("Pacote de instalação ausente.");return stream;}
    static void VerifyPayload(){using(var stream=Payload())using(var zip=new ZipArchive(stream,ZipArchiveMode.Read)){int voices=0;bool entry=false;foreach(var file in zip.Entries){string path=file.FullName.Replace('\\','/');if(path.StartsWith("assets/voice-pack/")&&path.EndsWith(".mp3"))voices++;if(path=="dist/index.html")entry=true;if(path.Contains("..")||path.Contains(":"))throw new IOException("Caminho inválido.");}if(voices!=41||!entry)throw new IOException("Pacote incompleto.");}}
    Setup(){
        Text="Jarvis Community · por Anderson";ClientSize=new Size(760,730);MinimumSize=MaximumSize=Size;StartPosition=FormStartPosition.CenterScreen;BackColor=Color.FromArgb(3,12,18);ForeColor=Color.FromArgb(202,241,246);Font=new Font("Segoe UI",10);FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;
        Label title=new Label{Text="J.A.R.V.I.S.  /  COMMUNITY",Font=new Font("Segoe UI",22,FontStyle.Bold),ForeColor=Color.Cyan,Location=new Point(28,18),Size=new Size(690,44)};Controls.Add(title);
        Controls.Add(new Label{Text="Seu cotidiano. Suas ferramentas. As 41 gravações já estão incluídas.",Location=new Point(30,68),Size=new Size(690,28)});
        Field("Pasta de instalação",destination,108);destination.Text=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"JarvisCommunity");
        Field("Seu nome",name,153);name.Text=Environment.UserName;
        Field("Sua cidade",city,198);
        Field("Fuso horário IANA",zone,243);zone.Text=DefaultZone();
        Field("Seus interesses",interests,288);
        Field("Seu trabalho / projetos",work,333);work.Multiline=true;work.Height=64;
        microphone.Text="Preparar microfone e reconhecimento de voz local (download adicional)";microphone.Checked=true;microphone.SetBounds(30,411,700,30);Controls.Add(microphone);
        Controls.Add(new Label{Text="A primeira instalação precisa de internet e pode levar alguns minutos.\nVocê conectará sua própria conta ChatGPT. Não precisa gerar novas vozes.",Location=new Point(30,449),Size=new Size(700,46)});
        log.Multiline=true;log.ReadOnly=true;log.ScrollBars=ScrollBars.Vertical;log.BackColor=Color.FromArgb(7,24,31);log.ForeColor=ForeColor;log.BorderStyle=BorderStyle.FixedSingle;log.SetBounds(30,505,700,130);Controls.Add(log);
        ButtonStyle(install,"INSTALAR / CONFIGURAR",30,653,255);ButtonStyle(login,"CONECTAR CHATGPT",300,653,215);ButtonStyle(launch,"ABRIR JARVIS",530,653,200);login.Enabled=launch.Enabled=false;
        install.Click+=async delegate{await Install();};login.Click+=delegate{OpenLogin();};launch.Click+=delegate{OpenJarvis();};FormClosing+=delegate(object sender,FormClosingEventArgs e){if(busy){e.Cancel=true;MessageBox.Show(this,"Aguarde a etapa em andamento terminar.",Text);}};
    }
    static string DefaultZone(){switch(TimeZoneInfo.Local.Id){case "E. South America Standard Time":return "America/Sao_Paulo";case "Eastern Standard Time":return "America/New_York";case "GMT Standard Time":return "Europe/London";case "SA Pacific Standard Time":return "America/Bogota";default:return "UTC";}}
    void Field(string label,TextBox field,int y){Controls.Add(new Label{Text=label,Location=new Point(30,y+3),Size=new Size(180,28)});field.SetBounds(212,y,518,30);field.BackColor=Color.FromArgb(8,31,40);field.ForeColor=ForeColor;field.BorderStyle=BorderStyle.FixedSingle;Controls.Add(field);}
    void ButtonStyle(Button button,string text,int x,int y,int width){button.Text=text;button.SetBounds(x,y,width,42);button.FlatStyle=FlatStyle.Flat;button.BackColor=Color.FromArgb(13,61,75);button.ForeColor=Color.Cyan;Controls.Add(button);}
    void Line(string text){if(IsDisposed)return;if(InvokeRequired){BeginInvoke((Action)(()=>Line(text)));return;}log.AppendText(text+Environment.NewLine);}
    async Task Install(){
        if(string.IsNullOrWhiteSpace(name.Text)){MessageBox.Show(this,"Informe como deseja ser chamado.",Text);return;}
        string root=Path.GetFullPath(destination.Text.Trim());
        if(root==Path.GetPathRoot(root)||root.TrimEnd('\\')==Environment.GetFolderPath(Environment.SpecialFolder.UserProfile).TrimEnd('\\')){MessageBox.Show(this,"Escolha uma pasta própria para o Jarvis.",Text);return;}
        var data=new{displayName=name.Text.Trim(),city=city.Text.Trim(),timezone=zone.Text.Trim(),interests=Array.FindAll(interests.Text.Split(','),s=>!string.IsNullOrWhiteSpace(s)),workContext=work.Text.Trim()};
        bool prepareMicrophone=microphone.Checked;busy=true;install.Enabled=false;log.Clear();
        string profile=Path.Combine(Path.GetTempPath(),"jarvis-profile-"+Guid.NewGuid().ToString("N")+".json");
        try{
            File.WriteAllText(profile,new JavaScriptSerializer().Serialize(data),new UTF8Encoding(false));
            await Task.Run(()=>{
                if(!File.Exists(Path.Combine(root,"package.json"))){
                    if(Directory.Exists(root)&&Directory.GetFileSystemEntries(root).Length>0)throw new IOException("A pasta escolhida não está vazia. Use uma pasta nova para preservar seus arquivos.");
                    Directory.CreateDirectory(root);Line("Extraindo aplicativo e 41 gravações prontas...");
                    using(var stream=Payload())using(var zip=new ZipArchive(stream,ZipArchiveMode.Read))foreach(var entry in zip.Entries){
                        string path=Path.GetFullPath(Path.Combine(root,entry.FullName.Replace('/',Path.DirectorySeparatorChar)));
                        if(!path.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new IOException("Caminho inválido no pacote.");
                        if(entry.FullName.EndsWith("/")){Directory.CreateDirectory(path);continue;}
                        Directory.CreateDirectory(Path.GetDirectoryName(path));using(var input=entry.Open())using(var output=new FileStream(path,FileMode.CreateNew))input.CopyTo(output);
                    }
                }else{
                    var p=new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string,object>>(File.ReadAllText(Path.Combine(root,"package.json")));
                    if(!p.ContainsKey("name")||!Object.Equals(p["name"],"jarvis-codex-community"))throw new IOException("Essa pasta pertence a outro aplicativo. Escolha um destino novo.");
                }
                string script=Path.Combine(root,"installer","Install-Community.ps1");
                string command="& '"+script.Replace("'","''")+"' -Destination '"+root.Replace("'","''")+"' -ProfilePath '"+profile.Replace("'","''")+"'"+(prepareMicrophone?" -Microphone":"");
                var start=new ProcessStartInfo("powershell.exe","-NoProfile -ExecutionPolicy Bypass -EncodedCommand "+Convert.ToBase64String(Encoding.Unicode.GetBytes(command))){WorkingDirectory=root,UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};
                using(var process=Process.Start(start)){process.OutputDataReceived+=delegate(object s,DataReceivedEventArgs e){if(e.Data!=null)Line(e.Data);};process.ErrorDataReceived+=delegate(object s,DataReceivedEventArgs e){if(e.Data!=null)Line(e.Data);};process.BeginOutputReadLine();process.BeginErrorReadLine();process.WaitForExit();if(process.ExitCode!=0)throw new IOException("A instalação encontrou uma falha. Consulte os detalhes acima e tente novamente.");}
            });
            installedRoot=root;login.Enabled=launch.Enabled=true;Line("Pronto. Conecte sua conta ChatGPT e abra o Jarvis.");
        }catch(Exception error){Line(error.Message);MessageBox.Show(this,error.Message,Text,MessageBoxButtons.OK,MessageBoxIcon.Information);}
        finally{busy=false;install.Enabled=true;try{File.Delete(profile);}catch(IOException){}}
    }
    void OpenLogin(){Process.Start(new ProcessStartInfo("powershell.exe","-NoProfile -NoExit -ExecutionPolicy Bypass -File \""+Path.Combine(installedRoot,"scripts","Connect-ChatGPT.ps1")+"\""){UseShellExecute=true,WorkingDirectory=installedRoot});}
    void OpenJarvis(){Process.Start(new ProcessStartInfo("powershell.exe","-NoProfile -ExecutionPolicy Bypass -File \""+Path.Combine(installedRoot,"scripts","Start-Jarvis.ps1")+"\""){UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,WorkingDirectory=installedRoot});}
}
