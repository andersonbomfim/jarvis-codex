# Telegram privado

1. Crie seu próprio bot pelo BotFather no Telegram. Guarde a credencial somente em `.local/telegram-token.txt`.
2. Obtenha seu identificador pessoal por um meio confiável e preencha `.local/telegram.json` com `ownerUserId`, `ownerChatId` iguais ao seu ID, `botUsername`, `enabled: true`, `voiceReplies: true` e `automaticReplyDelayMs: 2000`.
3. Reinicie os serviços desta cópia e envie `/start` ao seu bot. Use `/status` para confirmar o canal. O computador precisa estar acordado e conectado.

O programa exige remetente correto, chat privado e o mesmo ID de proprietário. Grupos, bots e outras contas não podem executar pedidos. Não coloque a credencial no README, em prints, no Git ou em um serviço público.

Mensagens por áudio são transcritas e interpretadas antes da resposta. Saudações usam uma única gravação correspondente. Trabalhos usam confirmação gravada, conclusão gravada e resultado em texto. O briefing já pronto é uma exceção: segue diretamente em um único áudio, sem repetir confirmação e narração escrita. Não há geração nova de voz nesses caminhos. O indicador mostra “gravando áudio” para entrada por áudio e “digitando” para texto.

`/cancelar` interrompe o pedido ativo; `/nova` limpa o contexto da conversa; `/texto` e `/voz` controlam o formato das respostas prontas. A mensagem curta automática tem uma espera de dois segundos, sem impor essa espera adicional aos trabalhos longos.

## Briefing enviado automaticamente

Depois de conectar seu próprio bot, você pode ativar em `.local/briefing-settings.json`:

```json
{"telegramDelivery":{"enabled":true,"mode":"when_ready"}}
```

A opção vem desativada em instalações novas. Com ela ativa, o bot envia uma única mensagem de áudio quando o briefing de hoje estiver pronto, para você escolher quando apertar play. Ele reutiliza `briefing.audio`, não gera voz nem envia uma narração escrita duplicada. O computador e o bot precisam estar funcionando; a verificação ocorre entre consultas de mensagens quando não há outro pedido em execução.

Um briefing já enviado manualmente no dia não é repetido automaticamente. O registro `telegram-delivery.json`, na pasta do dia, preserva a confirmação através de reinícios. Uma aceitação incerta não é reenviada cegamente; um pedido manual continua permitido. Esse envio nunca autoriza reprodução automática no computador ou mensagens a outras pessoas.
