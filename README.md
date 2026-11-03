# MacroPilot 1.1 — Etapa 3: Radar económico e agente virtual com proteção noticiosa

Esta entrega **atualiza a versão 1.0 sem apagar os dados virtuais anteriores** no mesmo navegador e domínio. É uma PWA de estudo e **paper trading**, não uma plataforma de ordens reais.

## NOVIDADES DA ETAPA 3

- `public/intelligence.js`: classificador local, determinístico e auditável de **títulos** de notícias por inflação, juros, dólar, PIB, emprego, geopolítica e energia. Não é um LLM, não lê o corpo de artigos e não verifica a veracidade de notícias.
- Radar de eventos no **Mapa económico**: contagem de temas publicados nas últimas 48 horas, títulos potencialmente relevantes, ativos com sensibilidades hipotéticas e proposta de cenário.
- **Aplicação manual do cenário**: só propõe direção se pelo menos duas manchetes recentes sobre o mesmo fator apontarem no mesmo sentido, e exige confirmação. Não gera compras por notícias.
- **Filtro de eventos** ativado por defeito: impede novas entradas **virtuais** em ativos relacionados com títulos de potencial impacto publicados nas últimas 6 horas. Em modo de dados externos, impede novas entradas se o feed não trouxer títulos recentes. Pode ser desligado pelo utilizador na secção Agente.
- **Explicação das decisões**: sinal, pontuação de regras, origem e data da cotação, motivo de aceitação ou bloqueio.
- **Melhorias de segurança**: paragem do agente ao ocultar a app, cancelar varreduras ainda pendentes quando se desliga o agente, intervalo mínimo de 30 minutos para reabrir um ativo fechado pelo agente, bloqueios por risco pré-existentes.
- **EUR/USD do BCE**: pode servir de cotação de referência sem histórico para gráficos/sinais quando o fornecedor principal não disponibiliza o par. Não representa preço spot negociável.
- **Testes:** 20 testes automáticos de motor e integrações simuladas; interação no navegador em tamanhos desktop/móvel com fontes simuladas. **Não houve validação de preços nem notícias reais ao vivo**, nem publicação efetuada.

## Instalação — escolher o pacote certo

### A) Demonstração sem APIs

1. Extrai `MacroPilot_Etapa3_Demo_Estatico.zip`.
2. Em https://app.netlify.com/drop arrasta a **pasta dos ficheiros extraídos** ou os ficheiros nela contidos.
3. Abre o endereço HTTPS. Na app escolhe **Demonstração** (preços e resultados inteiramente fictícios).
4. O radar de notícias e os indicadores públicos estarão indisponíveis neste pacote: o drag-and-drop estático não publica Netlify Functions.

### B) Projeto completo, para dados externos

1. Extrai `MacroPilot_Etapa3_Projeto_Completo.zip` e coloca o conteúdo da pasta `macropilot-etapa3` num repositório Git.
2. No Netlify, escolhe **Add new project → Import an existing project** e importa o repositório. O projeto contém `netlify.toml`, sem build necessária; `publish = "public"`, `functions = "netlify/functions"`.
3. Em **Project configuration → Environment variables**, define os segredos opcionais **com o escopo Functions**:
   - `TWELVE_DATA_API_KEY`: histórico diário para ativos abrangidos pelo plano.
   - `FRED_API_KEY`: indicadores de economia dos EUA.
   - `FINNHUB_API_KEY`: cotação pontual de algumas ações, sem histórico de indicador técnico.
4. Faz deploy novamente. **Nunca coloques estas chaves na pasta `public/` nem em ficheiros partilhados.**
5. Abre a app e escolhe **Dados externos** em Definições. As rotas `/.netlify/functions/market`, `/macro` e `/news` devem responder JSON.
6. Na secção **Mapa económico**, confirma os títulos e as datas antes de aceitares a proposta. O agente continua a executar **apenas operações virtuais**.

**Nota:** Gold API e o câmbio de referência do BCE podem funcionar sem chaves; no entanto, o ouro spot sem série histórica não permite calcular SMA/RSI, pelo que o agente não inventa sinais. Fontes externas podem estar inacessíveis, atrasadas ou sujeitas a licenças e limites comerciais. O feed de notícias é RSS e pode apresentar atrasos, repetição e falhas.

## Testes e manutenção

No diretório do projeto: `npm test` (Node 22+) e `npm run check`. Para testar funções localmente é necessário usar `netlify dev` (via Netlify CLI), com chaves de teste configuradas no ambiente.

**Limites relevantes**: sem execução de ordens em corretoras, sem chaves de corretoras, sem sincronização de contas, sem operações 24/7 com a app fechada, sem notificações push em segundo plano. Stop-loss virtual só é verificado no próximo ciclo e não garante saída ao preço indicado. Pontuação de regras não representa probabilidade de lucro; manchetes não comprovam causalidade. A utilização comercial exige respeitar licenças de dados e legislação aplicável.

---

## Documentação da versão anterior

# MacroPilot v1.0 — Aplicação de análise macroeconómica e paper trading

PWA responsiva para iOS, Android e Windows, com **modo DEMO funcional sem API** e integração opcional com dados externos por funções Netlify.

## O que está implementado

- Painel de ativos: ouro (XAU/USD), S&P 500 (SPY), Nasdaq (QQQ), NVIDIA, Apple, TLT, petróleo WTI e EUR/USD.
- Gráfico, watchlist, médias móveis (SMA 5 / 20), RSI 14 e motor de sinais simples.
- Mapa económico de fatores (inflação, juros, dólar, crescimento, emprego, risco geopolítico, energia) com controlos de cenário e sensibilidades ilustrativas.
- Indicadores públicos: câmbio de referência BCE, inflação, Treasury, Fed e desemprego dos EUA (FRED com chave).
- RSS de notícias económicas com links externos e atribuição.
- Carteira virtual inicial de **10 000 USD**, registo de entradas/saídas, stop-loss, take-profit e posição dimensionada por risco (máx. 25% do património por posição; sem alavancagem).
- Agente automático virtual: scan a cada 5 minutos **somente enquanto a página estiver aberta**, com interruptor e histórico.
- Dados da simulação gravados no dispositivo (localStorage) e exportáveis em JSON; app instalável como PWA.

## O que NÃO faz

- **Não coloca ordens reais, não liga a corretoras e não movimenta dinheiro.**
- **Não funciona 24/7 com a página fechada**, nem envia notificações push.
- Não valida automaticamente notícias para sinal; o mapa económico usa cenários manuais (heurísticos).
- Não é um consultor financeiro e não garante retornos. Pontuação de regras ≠ probabilidade de lucro.
- Preços DEMO são **100% inventados**, claramente identificados; nunca os confundir com mercado.
- Dados externos podem ter atraso, limitar ativos, exigir chave e parar de responder. As regras exigem 20 pontos históricos e não fabricam histórico a partir de snapshots.
- Não calcula custos transacionais, impostos, liquidez, deslizamento de preço nem dividendos.

## Começar já — versão de demonstração sem chaves

1. Descompacta `macropilot-demo-static.zip` (ou abre a pasta `public/` do pacote completo).
2. Publica os ficheiros da pasta `public` na Netlify via **Add new project → Deploy manually**, arrastando a pasta `public` (não o ZIP com a pasta do projeto toda).
3. Abre o endereço `https://...netlify.app` que a Netlify gerar.
4. Na app escolhe **DEMONSTRAÇÃO** para testar estratégias e agente em conta virtual.
5. Em iPhone abre no Safari → Partilhar → **Adicionar ao ecrã principal**; Android → menu do Chrome → **Instalar aplicação** (quando disponível).

> A publicação **manual de `public/` só publica o front-end**. As funções de notícias, BCE, ouro e mercado NÃO são incluídas no drag-and-drop estático. Usa a publicação completa abaixo para ter fontes externas.

## Publicação completa na Netlify (fontes externas)

1. Descompacta `macropilot-completo.zip` e coloca a pasta `macropilot-app` num repositório GitHub teu.
2. Na Netlify escolhe **Add new project → Import an existing project** e seleciona o repositório.
3. O `netlify.toml` configura `publish = "public"` e `functions = "netlify/functions"`. Não é necessário comando de build.
4. Publica o site. As rotas `/.netlify/functions/market`, `/macro` e `/news` devem responder JSON.
5. Em **Project configuration → Environment variables** configura, se quiseres:
   - `TWELVE_DATA_API_KEY` — histórico diário de mercado; regista uma chave no https://twelvedata.com/ e confirma cobertura, limites e licença do plano.
   - `FRED_API_KEY` — indicadores macro dos EUA: https://fred.stlouisfed.org/docs/api/api_key.html
   - `FINNHUB_API_KEY` — preço pontual alternativo de algumas ações: https://finnhub.io/ . Os snapshots não bastam para SMA/RSI.
6. Após editar variáveis de ambiente, **faz novo deploy**. Nunca guardes chaves em `public/` nem no JavaScript do browser.
7. Usa **Definições → Dados externos** na app e confirma as fontes. Sem chave, o ouro spot pode ser consultado por Gold API; outros símbolos podem ficar indisponíveis.

### Desenvolvimento e testes no computador

Requisitos: Node.js 22+. `npm test` executa os testes locais sem dependências adicionais; `npm run check` verifica sintaxe. Para servir Netlify Functions localmente, instala/usa Netlify CLI (`npx netlify-cli dev`) e configura as variáveis de ambiente no ambiente de desenvolvimento.

## Arquitetura e segurança

```
public/index.html       Interface
public/style.css        Design responsivo
public/app.js           Estado, gráficos, agente, UI e conta virtual
public/engine.js        Regras determinísticas, cálculo e risco
public/sw.js            Cache PWA estático
netlify/functions/market.mjs   Twelve Data / Finnhub / Gold API
netlify/functions/macro.mjs    BCE / FRED
netlify/functions/news.mjs     Google News RSS
```

Chaves de serviços só são utilizadas em funções server-side; não existe interface de autenticação ou contas de utilizador nesta versão. A conta de simulação fica neste navegador e **não sincroniza entre equipamentos**.

### Modelo económico

As relações são hipóteses de sensibilidades qualitativas (por exemplo, um dólar mais forte pode pressionar o ouro cotado em dólares). O mercado reage a expectativas, a múltiplas causas e a outros fatores; por isso, uma pontuação positiva ou negativa **não é uma previsão comprovada**.

### Risco e limitações de mercado

O modelo compra posições virtuais sem alavancagem até aos limites de risco configurados e fecha ao atingir limites de preço **na verificação seguinte da app** (não é um stop garantido). Pode haver lacunas e gaps. Os fornecedores têm regras próprias de acesso, exibição e uso comercial de dados. Antes de vender a app ou disponibilizar dados a terceiros, verifica as licenças e a regulação aplicável. Qualquer futura ligação a corretoras exige API oficial, autenticação segura, autorização e testes adicionais.

© Projeto experimental de código — MacroPilot 1.0.
