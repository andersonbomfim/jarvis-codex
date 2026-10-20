import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { readFile, mkdir } from 'node:fs/promises'
import { z } from 'zod'
import { createSdkMcpServer, tool } from './local-tools.mjs'

const exec = promisify(execFile)
const text = value => ({ content: [{ type: 'text', text: String(value) }] })
async function powershell(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 })
  return stdout.trim()
}
const quote = s => "'" + String(s).replace(/'/g, "''") + "'"

export function windowsServer() {
  return createSdkMcpServer({ name: 'windows', tools: [
    tool('get_system_info', 'Consulte CPU, memória, Windows e espaço livre em disco deste computador.', {}, async () => text(await powershell(`$os=Get-CimInstance Win32_OperatingSystem; $cpu=Get-CimInstance Win32_Processor | Select-Object -First 1; @{windows=$os.Caption; cpu=$cpu.Name; ramGB=[math]::Round($os.TotalVisibleMemorySize/1MB,1); freeRamGB=[math]::Round($os.FreePhysicalMemory/1MB,1); disks=@(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,@{n='freeGB';e={[math]::Round($_.FreeSpace/1GB,1)}})} | ConvertTo-Json -Depth 5`))),
    tool('list_processes', 'Mostre programas e processos em execução, ordenados por consumo de memória.', {}, async () => text(await powershell('Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 25 Id,ProcessName,@{n="memoryMB";e={[math]::Round($_.WorkingSet64/1MB,1)}},MainWindowTitle | ConvertTo-Json'))),
    tool('list_apps', 'Liste aplicativos registrados no menu Iniciar do Windows.', {}, async () => text(await powershell('Get-StartApps | Sort-Object Name | ConvertTo-Json'))),
    tool('open_app', 'Abra um aplicativo ou arquivo solicitado pelo usuário. Para apps da loja, forneça o AppID obtido em list_apps.', { target: z.string(), appId: z.boolean().optional() }, async ({ target, appId }) => {
      if (/\r|\n/.test(target)) throw new Error('Destino inválido.')
      await powershell(appId ? `Start-Process explorer.exe -ArgumentList ${quote('shell:AppsFolder\\' + target)}` : `Start-Process -FilePath ${quote(target)}`)
      return text('Solicitação de abertura enviada ao Windows. Verifique a janela antes de afirmar que está pronta.')
    }),
    tool('take_screenshot', 'Capture a tela principal quando o usuário pedir para ver, analisar ou explicar a tela. Retorna uma imagem real.', {}, async () => {
      const dir = join(import.meta.dirname, '..', '.local', 'screenshots'); await mkdir(dir, { recursive: true })
      const path = join(dir, `screen-${Date.now()}.png`)
      await powershell(`Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $i=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($i); try {$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size);$i.Save(${quote(path)},[System.Drawing.Imaging.ImageFormat]::Png)} finally {$g.Dispose();$i.Dispose()}`)
      return { content: [{ type: 'text', text: `Captura salva em ${path}` }, { type: 'image', mimeType: 'image/png', data: (await readFile(path)).toString('base64') }] }
    }),
  ] })
}
