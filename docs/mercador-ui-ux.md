# Especificação de UI/UX — Mercador no Foundry

## Objetivo e usuário

A configuração é exclusiva do mestre conector ativo. Ela associa exatamente um
ator do mundo à fonte pública do catálogo exibido no portal e no Discord, sem
prometer compras, transferências ou edição externa do inventário.

## Hierarquia e fluxo

1. A seção aparece somente no estado conectado, depois da sincronização de
   personagens e antes da zona de desconexão.
2. O cabeçalho explica o propósito e mantém o selo “Somente consulta”.
3. O campo persistente “Ator do Mercador” lista atores reais em ordem alfabética
   e inclui a opção explícita “Nenhum ator selecionado”.
4. “Salvar Mercador” persiste o ID exato e, quando houver seleção, dispara o
   primeiro envio.
5. Depois da configuração, o mestre vê a fonte, o horário do último envio, a
   quantidade de itens e a ação manual “Sincronizar catálogo”.

## Estados obrigatórios

- mundo sem atores: instrução para criar o ator;
- sem seleção: nenhum catálogo é enviado;
- seleção salva: dados da última sincronização ficam visíveis;
- ator removido: alerta persistente e nenhuma escolha automática substituta;
- navegador passivo: campos e ações desabilitados, junto da explicação geral do
  mestre conector;
- salvando ou sincronizando: ações desabilitadas e rótulo de progresso;
- sucesso: mensagem com `role=status`;
- erro ou ator ausente: mensagem com `role=alert`.

## Responsividade e acessibilidade

- Na largura normal de 720 px, seletor e ação compartilham a mesma linha.
- Em largura estreita, cabeçalho, seletor, métricas e ações formam uma coluna,
  sem rolagem horizontal.
- Campo e botões usam controles nativos, rótulos associados, ordem de foco
  previsível e foco visível.
- Cor nunca é a única indicação de estado; texto e ícones complementam os
  estados, e movimento respeita `prefers-reduced-motion`.

## Critérios de aceitação

- Somente mestre conector ativo pode alterar ou sincronizar a seleção.
- O ID salvo é do ator escolhido; excluir o ator não seleciona outro.
- Salvar uma seleção válida envia o catálogo imediatamente.
- Alterações no ator ou em seus itens agendam nova sincronização.
- Zero e quantidade desconhecida permanecem estados diferentes.
- HTML é convertido para texto sanitizado e imagens locais não são publicadas.
