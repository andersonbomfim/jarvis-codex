# Reconhecimento local de fala

O componente opcional de microfone usa Parakeet TDT 0.6B v3 int8, com reconhecimento multilíngue incluindo português e inglês. Ele transforma som em texto: não altera nem gera a voz do Jarvis. O processamento acontece no computador, sem uma API de transcrição paga.

No instalador 0.1.4, selecione a opção de reconhecimento local. Ela prepara Python, as bibliotecas e quatro arquivos de modelo, com download de aproximadamente 640 MiB, além das dependências. Os modelos ficam em `.local/models/parakeet-tdt-v3`, fora do Git e do pacote de distribuição. A revisão baixada está fixada no script de preparação.

Para uma cópia pelo código que já possua Python e o ambiente virtual:

```powershell
.venv/Scripts/python.exe -m pip install -r installer/requirements.txt
.venv/Scripts/python.exe scripts/setup-recognition.py
```

Depois, reinicie somente os serviços da sua cópia. `scripts/setup-recognition.py --whisper` instala o Whisper Base como alternativa; o mecanismo principal é selecionado quando os quatro arquivos Parakeet estão completos. As gravações das 41 frases nunca são geradas por esses comandos.

O modelo é carregado antecipadamente pelo serviço. O primeiro carregamento leva mais tempo; chamadas posteriores reutilizam o mesmo processo. Na máquina de desenvolvimento, a mesma frase curta passou de cerca de 10,3 segundos com Whisper Small para 1,5 segundo no endpoint já carregado. Isso não é uma promessa para todo computador e não inclui interpretação, pesquisa ou execução da resposta.

A entrada começa no microfone padrão do próprio Windows e permite seleção manual nas configurações. Nenhum dispositivo do criador é imposto. Silêncio e ruído passam por detecção neural; transcrições incertas ou excessivamente repetitivas são rejeitadas. As amostras do microfone ficam somente na memória, e os diagnósticos HTTP expõem contadores e medidas numéricas, sem o texto reconhecido.

Modelo original e licença: https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3

Conversão utilizada: https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8

Integração: https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/nemo-transducer-models.html
