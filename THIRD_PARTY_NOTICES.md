# Créditos e componentes

- **Aditya Dewaskar — adewaskar/jarvis:** base da interface e do assistente, sob MIT. O aviso original foi preservado em LICENSE. https://github.com/adewaskar/jarvis
- **walterleonardo/jarvis_opensource:** base local usada para as adaptações Windows e do bridge. https://github.com/walterleonardo/jarvis_opensource
- **Anderson (andersonbomfim):** direção do produto, adaptações Codex, cotidiano e perfil pessoal, interface e distribuição Community, integração OpenSpeaker, política de gravações, pacote das 41 frases e evolução do fluxo de conversa.
- **OpenAI Codex:** executável separado, obtido do fornecedor e usado com o login da própria pessoa. Não se distribuem credenciais ou limites de uma conta. https://github.com/openai/codex
- **Microsoft WebView2 SDK:** wrappers e loader distribuídos conforme os termos do pacote Microsoft.Web.WebView2 1.0.4258.31. O instalador do Runtime é fornecido pela Microsoft. https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.4258.31
- **Node.js:** runtime obtido de nodejs.org, com sua licença incluída no arquivo oficial. https://nodejs.org
- **Python / faster-whisper / CTranslate2 / PyAV:** opcionais para reconhecimento local; instalados separadamente, sob as licenças dos respectivos fornecedores. Reconhecimento de fala não é geração de voz.
- **Dependências JavaScript:** versões e integridade no package-lock.json. React, Three.js, Zustand, Zod, ws e demais bibliotecas mantêm suas próprias licenças.

A licença deste repositório não muda licenças de dependências nem atribui exclusividade sobre nomes, marcas ou personagens de terceiros. Não há patrocínio ou vínculo oficial implícito.

- **sherpa-onnx (Apache-2.0) e NVIDIA Parakeet TDT 0.6B v3 (CC-BY-4.0):** reconhecimento multilíngue opcional. Conversão int8 de csukuangfj/k2-fsa. Os pesos são baixados separadamente para a pasta privada da instalação, sem integrar o código ou o pacote das vozes. Modelo original: https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3 — conversão: https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8 — licença do modelo: https://creativecommons.org/licenses/by/4.0/
