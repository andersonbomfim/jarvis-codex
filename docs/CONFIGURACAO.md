# Configuração pessoal

O instalador pede nome, cidade, fuso IANA, interesses e contexto de trabalho. Também é possível usar `npm run configure`. Os dados ficam em `.local/profile.json`, nunca nos arquivos públicos.

Durante a conversa, você pode informar “prefiro resumos desenvolvidos sobre política”, “agora moro em Recife” ou “este é meu novo projeto”. O Jarvis possui ferramentas para consultar e atualizar preferências confirmadas e lembrar decisões de projetos; ele não deve inferir biografia, religião ou posição política de personagens e arquivos de ficção.

## Arquivos e projetos

`.local/discovery/roots.json` contém os escopos locais autorizados para descoberta superficial. O padrão é a pasta pessoal, sem varredura integral de discos. Acrescente outras pastas específicas quando quiser. A continuidade de um projeto existente usa a pasta real; um trabalho novo realmente pedido ganha sua própria pasta. Registros de decisões ficam em `.local/projects/state.json`.

Para permitir execução de ações e edição de arquivos, altere `allowWrites` para `true` em `.local/profile.json` e reinicie somente os serviços desta instalação. O padrão é leitura; compras, envios a terceiros e operações destrutivas continuam sujeitos ao pedido e à confirmação pertinente. Essa chave permite que o agente execute ações reais: habilite-a quando quiser essa capacidade.

## Gmail, agenda e navegador

As ferramentas MCP que você conectar ficam em `jarvis.config.local.json`, ignorado pelo Git. Não copie credenciais de outra pessoa. Configure os servidores oficiais das ferramentas que usa, conclua seus próprios logins e peça ao Jarvis uma consulta real para validar. Nem um login histórico nem uma aba aberta bastam para garantir acesso futuro.

Formato de configuração:

```json
{"mcpServers":{"nome-da-sua-integracao":{"command":"caminho-do-servidor","args":[]}}}
```

O navegador de automação pode usar Chrome DevTools MCP com perfil próprio. Faça login nesse perfil quando necessário; não importe cookies nem dados pessoais do criador. A integração de Gmail e Google Agenda não é automaticamente herdada do aplicativo Codex: confirme que o servidor configurado para esta cópia oferece as ferramentas necessárias.

## Voz

Os 41 MP3 em assets/voice-pack já estão prontos e são conferidos por SHA-256. Eles funcionam sem API de síntese ou conta OpenSpeaker. A entrada do microfone segue o padrão do computador; você pode escolher outro dispositivo nas configurações. O reconhecimento local Parakeet, com português e inglês, é opcional na instalação, mas é necessário para transcrever áudios do Telegram sem depender de outro serviço.

A voz dinâmica está desativada. Uma futura ativação exige a conta, a voz e a autorização da própria pessoa; não é necessária para usar as frases do pacote. Não execute scripts de geração para instalar ou reparar essas gravações.

Veja [reconhecimento local](RECONHECIMENTO.md) para atualizar uma instalação anterior. O modelo Whisper permanece disponível como alternativa explícita.
