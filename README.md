# Jarvis Codex Community

Um assistente pessoal para Windows, adaptável ao cotidiano de cada pessoa, com interface futurista animada, Codex como inteligência e **41 respostas de voz prontas em português**.

**Criado e organizado por Anderson ([andersonbomfim](https://github.com/andersonbomfim)), a partir do projeto MIT de Aditya Dewaskar e de suas adaptações para Windows.**

## Instalação para quem só quer usar

1. Baixe **Jarvis-Setup-0.1.0.exe** na página de [Releases](https://github.com/andersonbomfim/jarvis-codex/releases).
2. Execute, informe seu nome, cidade, fuso horário, interesses e contexto de trabalho e clique em **Instalar / configurar**. O assistente prepara as dependências em uma pasta própria do usuário; a primeira instalação precisa de internet.
3. Clique em **Conectar ChatGPT** e faça o login na sua própria conta. Depois clique em **Abrir Jarvis** ou use o atalho da área de trabalho.
4. Permita o microfone e escolha sua entrada nas configurações, se necessário. Você também pode conversar por texto.

O aplicativo abre em uma janela Windows própria, usando Microsoft WebView2. Fechar a janela não encerra outros programas nem seu wallpaper. Esc fecha a janela; F11 alterna a apresentação. Os serviços podem ser encerrados por `scripts/Stop-Jarvis.ps1`.

Windows 10/11 de 64 bits e .NET Framework 4.8 são a base desta versão. O instalador prepara Node, Codex e WebView2; o reconhecimento local opcional prepara Python e Whisper. Ele não reinicia, hiberna ou altera a BIOS. A versão 0.1.0 ainda não possui assinatura digital de distribuição. Confira `SHA256SUMS.txt` no Release.

## O que já vem pronto

- Interface animada, símbolo circular neon, conversas e arquivos de entrega.
- As mesmas **41 gravações**: saudações, presença, agradecimentos, espera, consulta de agenda/e-mail/clima, conclusão, impedimento e falha. Nenhuma dessas frases precisa ser gerada novamente.
- Interpretação dos pedidos e do contexto: não é necessário decorar comandos. Frases sociais simples usam atalhos rápidos; pedidos ambíguos passam pela inteligência antes de escolher a resposta.
- Telegram privado, com áudio de entrada transcrito antes da resposta; confirmações reutilizam gravações e o resultado do trabalho é texto. O indicador acompanha o formato de entrada: gravando áudio ou digitando.
- Perfil pessoal local, memória de decisões, descoberta de projetos existentes e consulta de referências. A configuração começa sem o perfil, a agenda, os livros ou os dados do criador.
- Estrutura de briefing: saudação/data, clima, agenda/deslocamentos, informações úteis, notícias e projetos confirmados. As integrações e o agendamento precisam ser configurados para a pessoa.

As gravações curtas são fixas e usam a expressão “senhor”; o programa não inventa gravações com o nome de cada pessoa. **A adaptação é pessoal e contextual**, pela memória e pelas ferramentas de cada usuário. Resultados extensos permanecem em texto. Geração de voz nova fica desabilitada por padrão; o pacote não exige conta ou créditos OpenSpeaker para reproduzir essas gravações.

## O que cada pessoa conecta

A inteligência usa **sua própria instalação e autenticação do Codex** e está sujeita ao acesso e aos limites da sua conta. As gravações prontas não têm custo de síntese, mas isso não torna o processamento do modelo ilimitado. Não há assinatura Claude obrigatória nem chave Anthropic necessária no caminho padrão.

Agenda, Gmail, navegador, Telegram e outras ferramentas **não vêm conectados à conta de Anderson**. Veja [configuração pessoal](docs/CONFIGURACAO.md), [Telegram](docs/TELEGRAM.md) e [briefing](docs/briefing-matinal.md). Uma aba aberta em outro aplicativo não comprova uma integração: confira a conexão real.

## Instalação pelo código

```powershell
git clone https://github.com/andersonbomfim/jarvis-codex.git
cd jarvis-codex
npm ci
npm run configure
npm run build
npm start
```

Instale e autentique o Codex pelo método oficial. Para compilar a janela e o instalador no Windows, execute `scripts/Build-Release.ps1` depois do build. A versão portátil contém os arquivos do aplicativo; execute `installer/Install-Community.ps1` com uma configuração pessoal para preparar as dependências.

```powershell
npm test
npm run audit
npm run doctor
```

`doctor` indica quais componentes ainda faltam, sem gerar áudio ou fazer pedidos ao modelo. Os testes usam respostas simuladas para não consumir créditos de voz.

## Dados e uso diário

Tudo que pertence à pessoa fica em `.local`: perfil, preferências, histórico, projetos, sessões e credenciais. Essa pasta é ignorada pelo Git. Os serviços HTTP ficam em `127.0.0.1`; este projeto não publica o controle do seu computador na internet. GitHub hospeda o código e os instaladores, e cada pessoa executa sua própria cópia.

O perfil pode evoluir durante a conversa, com fatos e preferências confirmados por você. Nenhuma varredura integral de discos ocorre na instalação. A descoberta inicial é superficial e parte da sua pasta pessoal; escopos adicionais são configuráveis. Ações de escrita estão desligadas por padrão; veja como habilitar somente o que você pretende usar.

## Autoria e licença

Código sob [MIT](LICENSE), preservando Aditya Dewaskar e acrescentando o copyright das adaptações de Anderson. Consulte [créditos de terceiros](THIRD_PARTY_NOTICES.md). O pacote das gravações tem seu próprio [aviso de licença](assets/voice-pack/LICENSE), com atribuição a Anderson. O nome Jarvis é uma referência cultural; este projeto é independente de Marvel, Disney, OpenAI e dos demais fornecedores.

Esta é uma primeira versão pública. Os testes automatizados e a integridade do instalador são verificáveis; uma instalação em outra máquina, seus dispositivos e suas integrações precisam de validação própria. Consulte [o escopo de testes](docs/VALIDACAO.md).
