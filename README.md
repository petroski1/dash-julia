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

## Dados

Tudo fica salvo no próprio navegador (localStorage). Use **Configurações → Exportar dados** para fazer backup
e **Importar dados** para levar para outro computador/celular.

Em **Configurações** dá pra mudar os nomes das pessoas, cadastrar cartões (fechamento, vencimento, limite) e editar as categorias.
