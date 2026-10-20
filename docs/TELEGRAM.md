# Telegram privado

1. Crie seu próprio bot pelo BotFather no Telegram. Guarde a credencial somente em `.local/telegram-token.txt`.
2. Obtenha seu identificador pessoal por um meio confiável e preencha `.local/telegram.json` com `ownerUserId`, `ownerChatId` iguais ao seu ID, `botUsername`, `enabled: true`, `voiceReplies: true` e `automaticReplyDelayMs: 2000`.
3. Reinicie os serviços desta cópia e envie `/start` ao seu bot. Use `/status` para confirmar o canal. O computador precisa estar acordado e conectado.

O programa exige remetente correto, chat privado e o mesmo ID de proprietário. Grupos, bots e outras contas não podem executar pedidos. Não coloque a credencial no README, em prints, no Git ou em um serviço público.

Mensagens por áudio são transcritas e interpretadas antes da resposta. Saudações usam uma única gravação correspondente. Trabalhos usam confirmação gravada, conclusão gravada e resultado em texto. O briefing já pronto é uma exceção: segue diretamente em um único áudio, sem repetir confirmação e narração escrita. Não há geração nova de voz nesses caminhos. O indicador mostra “gravando áudio” para entrada por áudio e “digitando” para texto.

`/cancelar` interrompe o pedido ativo; `/nova` limpa o contexto da conversa; `/texto` e `/voz` controlam o formato das respostas prontas. A mensagem curta automática tem uma espera de dois segundos, sem impor essa espera adicional aos trabalhos longos.
