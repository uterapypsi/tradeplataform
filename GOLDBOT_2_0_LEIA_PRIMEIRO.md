# GoldBot AI 2.0 — publicação sem perder o MacroPilot

## Estado da entrega

- Código e **28 testes locais aprovados** em Node.js 22.
- **Ainda não publicado** no Netlify/GitHub: a publicação precisa de confirmação do proprietário.
- Totalmente **paper trading**: não tem código, credenciais nem pedidos para enviar ordens a corretoras.
- Continua a suportar o MacroPilot 1.1 no mesmo site. O novo painel está em `/goldbot-v2.html`.

## Comportamento real

- A função Netlify `goldbot-scheduled` é programada para o minuto 15 de cada hora, em UTC (`15 * * * *`).
- Consulta séries **diárias** de `XAU/USD` via a **Twelve Data**, reutilizando a chave já configurada.
- Ignora a vela diária do próprio dia para evitar usar dados ainda em formação. Só avalia um fecho novo uma vez.
- Exige 20 velas, dados com no máximo 5 dias, títulos de notícias recentes e regras técnicas (SMA 5/20, RSI 14) favoráveis.
- Mantém carteira virtual separada no **Netlify Blobs**, com controlo de risco, taxas e slippage aproximados.
- Limites de stop e take-profit são **verificados no fecho diário disponível**, não são ordens stop reais nem garantem preços.
- Não funciona como um processo permanente. As execuções agendadas podem falhar, sofrer atrasos ou ser limitadas pelo plano/fornecedor.
- Não lê nem opera os valores de uma conta bancária ou corretora. As séries FRED não são ainda transformadas em sinais automáticos do GoldBot 2.0; continuam no painel 1.1.

## Segurança: desligado por defeito

São necessárias **duas novas variáveis de ambiente** (além de `TWELVE_DATA_API_KEY` já existente):

| Key | Value | Nota |
|---|---|---|
| `GOLDBOT_V2_ENABLED` | `true` | Interruptor geral do servidor; com valor diferente de `true`, fica desligado. Criar em Production e Functions. |
| `GOLDBOT_V2_ADMIN_TOKEN` | uma frase aleatória **com pelo menos 24 caracteres** | Chave privada de acesso ao monitor e ao botão de pausa/ativação; marcar como secreta. |

Não colocar credenciais de API nem o token no GitHub, no chat ou em arquivos públicos. Gera um token novo com o gestor de passwords. O token só é enviado pelo navegador ao próprio serviço Netlify, através de HTTPS, e não é guardado no `localStorage`.

Além do interruptor geral no Netlify, o GoldBot começa **pausado no painel**. Para ativá-lo: abrir `/goldbot-v2.html`, autenticar-se e carregar em **Ativar simulação no servidor**. Para parar, carregar em **Pausar agente**. Se precisares de uma paragem de emergência, muda `GOLDBOT_V2_ENABLED` para `false` e faz novo deploy.

## Publicação no GitHub a partir do iPhone

Repositório: https://github.com/uterapypsi/tradeplataform
Site: https://tradeplataform.netlify.app
Deploys: https://app.netlify.com/projects/tradeplataform/deploys

**Não uses Netlify Drop com um ZIP isolado:** o projeto já tem GitHub ligado e funções que devem ser construídas a partir do repositório.

Caminho com GitHub Codespaces, se disponível na tua conta:

1. Guarda o ZIP `GoldBot_2_0_Atualizacao_GitHub.zip` na app Ficheiros do iPhone.
2. Abre o repositório GitHub no **Safari** (a versão para computador pode ajudar).
3. Abre **Code → Codespaces → Create codespace on main**.
4. No explorador do Codespace, carrega o ZIP para a **raiz** do repositório. Se a opção de upload não aparecer, experimenta a versão para computador ou um PC.
5. Abre o terminal do Codespace e executa:

```bash
unzip -o GoldBot_2_0_Atualizacao_GitHub.zip
rm GoldBot_2_0_Atualizacao_GitHub.zip
npm test
npm run check
git add .
git commit -m "feat: GoldBot 2.0 paper trading agendado"
git push origin main
```

6. Abre os Deploys do Netlify. Confirma **Published** no novo commit. Se falhar, consulta o log do deploy.
7. Confirma que o site antigo continua disponível e abre `https://tradeplataform.netlify.app/goldbot-v2.html`.
8. Cria as duas variáveis indicadas na secção anterior (mantém a existente `TWELVE_DATA_API_KEY`). Faz novo deploy para aplicar as variáveis.
9. Abre o painel, introduz o token, carrega em **Consultar estado** e depois **Ativar simulação no servidor**.
10. No Netlify, entra em **Functions → goldbot-scheduled → Run now** para fazer um teste imediato (funções agendadas não podem ser testadas chamando o seu URL). Volta ao painel e consulta o histórico.

O Codespaces pode ter limites de utilização e custos associados ao teu plano. **Não uses um serviço pago sem verificar os custos.** Como alternativa, podes aplicar os ficheiros de atualização com Git num computador.

## O que inclui a atualização

- `netlify/lib/goldbot-core.mjs`: motor virtual testável.
- `netlify/lib/goldbot-services.mjs`: dados históricos e títulos.
- `netlify/lib/goldbot-auth.mjs`: autenticação de consulta.
- `netlify/functions/goldbot-scheduled.mjs`: execução cron.
- `netlify/functions/goldbot-status.mjs`: consulta autenticada do saldo e registos.
- `netlify/functions/goldbot-control.mjs`: iniciar e pausar o agendamento após autenticação.
- `public/goldbot-v2.html`: painel privado para telemóvel.
- `public/index.html` e `public/sw.js`: ligação do menu e nova versão do cache.
- `package.json`: dependência `@netlify/blobs` e comandos de verificação.
- `netlify/functions/macro.mjs`: mantém as correções já aplicadas ao repositório.
- `tests/goldbot-v2.test.mjs`: testes de segurança, histórico, duplicação e limites.

## Limitações e avisos

Esta primeira entrega valida as regras do motor **localmente**; a execução agendada, o armazenamento Blobs e a autorização do painel só podem ser verificados depois da publicação no Netlify. Não há garantia de execução pontual, de resultados financeiros ou de preços de mercado. O Blobs usa consistência forte e gravação condicional, mas **não é uma base transacional**; antes de qualquer integração real com corretoras, seria necessário redesenhar a gestão de ordens com autenticação, reconciliação e idempotência fortes.

A operação com dinheiro real **não faz parte deste pacote**.
