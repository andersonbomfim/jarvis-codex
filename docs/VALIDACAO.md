# Validação e limites da versão 0.1.2

O projeto inclui testes de política de voz, reuso de gravações, interpretação, mensagens Telegram, junção de textos, preservação de contexto, leitura do briefing e configuração pessoal. Eles usam fornecedores simulados e arquivos temporários; não geram voz nem enviam mensagens.

O build gera a interface e o aplicativo Windows. O instalador possui `--verify-payload` para conferir os 41 MP3 e os arquivos essenciais sem instalar, iniciar serviços ou autenticar contas. O SHA-256 de cada gravação é validado, e o Release inclui o hash do instalador.

O fluxo original foi desenvolvido no computador do criador. A distribuição adaptável é uma primeira versão pública: não declare que microfone, alto-falante, integrações ou despertar funcionarão em outro computador sem um teste real. CI em Windows valida código e empacotamento; não comprova som audível, login pessoal ou recuperação de hibernação. Esses testes físicos não são automatizados nesta versão.

Gmail, Google Agenda, portais profissionais e Telegram exigem contas e conexões da própria pessoa. A rotina diária requer configuração própria; o instalador não replica as automações privadas do criador. Nenhuma instalação deve reutilizar outra conta, histórico, perfil ou credencial.
