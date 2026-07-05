# 💰 Meu Financeiro

Site de controle financeiro pessoal — a evolução do seu bloco de notas do iPhone.
Login de usuários, resumo do mês, controle de parcelas e **projeção da data em que
você vai estar melhor financeiramente**.

![Node >= 22.5](https://img.shields.io/badge/node-%E2%89%A522.5-blue)

## O que ele faz

- **Login e cadastro de usuários** — senha criptografada (scrypt) e sessão por cookie seguro (HttpOnly).
- **Dados do mês** — receitas, despesas, parcelas do mês e a sobra final, com seletor de mês.
- **Lançamentos** — registre cada receita e despesa com categoria, data e marcação de "fixo" (repete todo mês).
- **Parcelas** — cadastre compras parceladas e financiamentos: quantas já pagou, quantas faltam,
  valor restante, mês da próxima parcela e mês em que termina. Botão "Pagar parcela" a cada mês.
- **Projeção financeira** — com a média dos seus últimos 3 meses e o cronograma das parcelas,
  o site mostra **o mês em que sua última parcela é quitada** e o primeiro mês com sobra positiva,
  com gráfico mês a mês.
- **Dívidas com pessoas** — anote quem te deve e a quem você deve (pessoa, motivo, valor,
  data combinada), marque como quitada e veja os totais a receber/pagar.
- **Evolução do saldo** — gráfico do saldo acumulado mês a mês desde o início dos registros.
- **Exportar para Excel/CSV** — lançamentos, parcelas e dívidas, no formato brasileiro
  (`;` e vírgula decimal), abre direto no Excel.
- **Gráficos** — receitas × despesas dos últimos 6 meses e despesas por categoria, com modo escuro automático.
- **Mercado financeiro** — dólar, euro e bitcoin ao vivo com tendência de 30 dias (AwesomeAPI),
  Selic/CDI/IPCA (Banco Central), conversor de moedas e simulador "sua sobra rendendo".
  Sem internet no servidor? Rode com `MARKET_FAKE=1` para dados de demonstração.
- **Metas de economia** — objetivo, valor guardado, barra de progresso e estimativa de
  quando você chega lá com a sua sobra projetada.
- **Orçamento por categoria** — limite mensal com barra que avisa aos 75% e ao estourar.
- **Lançamentos fixos automáticos** — o que é marcado como "fixo" entra sozinho no mês novo.
- **Editar, buscar e filtrar lançamentos**, além de **backup/restauração em 1 clique** (JSON).
- **Aplicativo instalável (PWA)** — ícone na tela do celular, abre em tela cheia e
  permite consulta offline dos últimos dados vistos.
- **Tema claro/escuro/automático** com alternador manual.

## Como rodar

Só precisa do [Node.js 22.5+](https://nodejs.org) — **nenhuma dependência para instalar**
(o banco SQLite já vem embutido no Node).

```bash
node server.js
# abra http://localhost:3000
```

Variáveis opcionais:

| Variável   | Padrão   | Para quê                          |
|------------|----------|-----------------------------------|
| `PORT`     | `3000`   | Porta do servidor                 |
| `DATA_DIR` | `./data` | Onde fica o banco `financeiro.db` |

## Estrutura

```
server.js          # servidor HTTP + arquivos estáticos
lib/db.js          # banco SQLite (schema criado automaticamente)
lib/auth.js        # senhas (scrypt), sessões e cookies
lib/api.js         # rotas da API + cálculo da projeção
public/login.html  # tela de login e cadastro
public/index.html  # painel (visão geral, lançamentos, parcelas, projeção)
public/app.js      # lógica do painel
public/charts.js   # gráficos em SVG puro
public/styles.css  # tema claro/escuro
```

Os valores são armazenados em **centavos (inteiros)** para evitar erros de arredondamento.

## Como a projeção é calculada

1. Média de receitas e despesas dos últimos 3 meses com lançamentos.
2. Para cada mês futuro, soma-se o valor das parcelas que vencem naquele mês
   (a data da próxima parcela + quantas faltam determinam o cronograma restante).
3. `sobra do mês = receita média − despesa média − parcelas do mês`.
4. O **ponto de virada** é o mês seguinte à última parcela; o site também aponta
   o primeiro mês projetado com sobra positiva e o acumulado mês a mês.

Quanto mais meses você registrar, mais precisa fica a média.

## Colocando na internet

### Teste rápido (link temporário a partir do seu PC)

Com o servidor rodando (`npm start`), abra **outro** terminal e rode:

```bash
npx localtunnel --port 3000
```

Ele imprime um link `https://…loca.lt` que qualquer pessoa pode abrir enquanto
seu computador estiver ligado. Ao abrir pela primeira vez, o visitante confirma
uma tela de aviso do serviço e pronto.

### Hospedagem permanente (Render)

O repositório já traz um `render.yaml` pronto:

1. Crie uma conta em [render.com](https://render.com) entrando com o GitHub.
2. **New +** → **Blueprint** → selecione o repositório `pessoalfinanceiro`.
3. Confirme e aguarde o deploy — o site fica em `https://meu-financeiro….onrender.com`.

⚠️ No plano **Free** o serviço hiberna após ~15 min sem uso (o primeiro acesso
demora um pouco) e **os dados são apagados a cada deploy/reinício** — bom para
demonstrar, ruim para valer. Para uso real, assine uma instância paga com
**disco persistente** montado em `/var/data` e defina `DATA_DIR=/var/data`
(instruções comentadas no próprio `render.yaml`), ou use
[Railway](https://railway.app)/[Fly.io](https://fly.io) com volume.

### Outras dicas de produção
- **HTTPS é obrigatório** em produção (o cookie de sessão trafega nas requisições).
  Essas plataformas já entregam HTTPS automaticamente; numa VPS, use Caddy ou
  Nginx + Let's Encrypt na frente.
- **Backup**: o banco é um único arquivo (`data/financeiro.db`). Copie-o
  periodicamente (ex.: cron diário para um bucket ou outra máquina).
- **Migração do bloco de notas**: cadastre primeiro as parcelas em aberto (com o
  campo "parcelas já pagas") e depois registre 2–3 meses de receitas/despesas —
  a projeção já nasce útil.
