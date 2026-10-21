# Briefing adaptado à pessoa

Consulte `.local/profile.json`, `.local/briefing-settings.json` e as integrações reais configuradas pela própria pessoa. Não use dados, compromissos, livros ou preferências de Anderson. O preparo sugerido começa às 06h25, com objetivo de arquivo pronto às 06h55, antes das 07h. Os horários podem ser ajustados; nenhuma tarefa Windows ou automação Codex é criada na instalação.

O roteiro começa com saudação e data, segue diretamente para o clima da cidade da pessoa e conecta suas consequências à agenda e aos deslocamentos. Inclua e-mails que pedem ação, notícias importantes e até quatro projetos reais; preserve contexto e transições, sem títulos falados. Priorize interesses confirmados no perfil. Até 500 palavras e 10 mil caracteres, sem URLs, Markdown, credenciais ou detalhes técnicos na narração.

Confirme fontes e data local em cada execução. Consulte todos os calendários pertinentes com seus IDs e a janela do dia no fuso escolhido; resultados vazios precisam de cobertura e confirmação adequadas. Nunca declare dia livre com base em falha de acesso. Em e-mails, não responda, marque como lido nem altere etiquetas. Não crie compromissos ou mova arquivos durante a consulta. O briefing diário não é uma autorização para mensagens a terceiros.

Arquivos de cada dia em `.local/briefings/AAAA-MM-DD`: briefing.txt, briefing.md e sources.json. Áudio novo não é gerado por padrão nesta distribuição. As 41 frases existentes continuam funcionando sem OpenSpeaker. Se você optar por configurar futuramente geração do briefing com sua própria conta, confira o custo, o estado de geração e a deduplicação antes de ativar uma automação. Nunca gere novamente as frases prontas.

Uma rotina deve pesquisar e preparar antes do horário desejado, validar a data e entregar o artefato do dia. Registros antigos não são dados atuais. Um pedido para ouvir o briefing já pronto deve reutilizar somente o áudio de hoje; se ele não existir, informar a falta sem gerar ou reproduzir uma gravação antiga.

Exemplo de instrução para sua própria automação Codex: “Às 06h25 no meu fuso, leia docs/briefing-matinal.md e meu perfil local; consulte fontes, e-mails, agendas e projetos autorizados e prepare os três arquivos do briefing de hoje antes das 07h00. Nesta instalação não gere áudio novo. Não altere contas, agenda ou mensagens. Registre fontes indisponíveis sem inventar conteúdo.” Confira o horário real da próxima execução e faça um teste com suas próprias integrações antes de depender da rotina.

## Entrega sem reprodução inesperada

No aplicativo, o briefing só toca mediante pedido. Não existe reprodução automática às 07h nem ao concluir a geração, abrir ou reconectar o Jarvis. Versões antigas da interface também não conseguem reservar uma reprodução automática no servidor novo.

No Telegram, o envio automático do arquivo pronto é opcional e vem desativado. Ative `telegramDelivery.enabled` somente depois de conectar e autorizar seu próprio bot. A mensagem é enviada uma vez por dia e você decide quando apertar play. Um envio manual anterior conta como entregue. Consulte [Telegram](TELEGRAM.md).

A preparação, as conexões e a geração do áudio continuam exigindo configuração e autorização próprias. A instalação não cria agendamentos privados do criador nem gera voz por conta própria. Preserve uma tarefa já aceita e seu áudio: um pedido de leitura ou um envio no Telegram não deve gerar outra cobrança.
