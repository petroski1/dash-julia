# Minhas Finanças

Dashboard financeiro pessoal, claro e simples, que roda direto no navegador (sem servidor e sem instalar nada).

**Como abrir:** dê dois cliques no `index.html`, ou publique a pasta no GitHub Pages.

## O que ele mostra

- **Quanto entrou, quanto saiu e quanto sobrou** no mês, comparando com o mês anterior.
- **Para onde está indo**: saídas do mês por categoria.
- **De quem é**: cada lançamento tem um dono (ex.: Julia, Pai, Davis). Dá pra filtrar o painel inteiro por pessoa e ver a tabela de quem entrou/gastou quanto.
- **Entradas × saídas** dos últimos 6 meses (clique num mês para abrir ele).
- **Cartão de crédito**:
  - fatura do mês de cada cartão e quanto do limite está comprometido;
  - próximas 6 faturas;
  - compras parceladas em andamento (parcela atual, quando termina, quanto falta).
  - A compra cai na fatura certa de acordo com o dia de fechamento e vencimento do cartão.
- **Lançamentos fixos** (salário, aluguel, assinaturas) com "Repete todo mês".

## Dados (Supabase)

Os dados ficam no **Supabase** e atualizam sozinhos, na hora, em todos os aparelhos (celular, computador…).

- Entre com e-mail e senha (botão **Criar conta** na primeira vez).
- O **primeiro e-mail** que entrar vira dono dos dados. Para liberar outra pessoa:
  **Configurações → Quem tem acesso → Dar acesso**, e ela cria a conta com aquele e-mail.
- Tabelas e regras de segurança: `supabase/schema.sql` (cada um só vê os dados se o e-mail estiver liberado).
- Conexão: `config.js` (URL do projeto + chave *publishable*, que pode ser pública).

Sem Supabase configurado (ou clicando em "Usar só neste navegador"), o app funciona só com o navegador.
O backup em **Configurações → Exportar dados** continua disponível.

Em **Configurações** dá pra mudar os nomes das pessoas, cadastrar cartões (fechamento, vencimento, limite) e editar as categorias.
