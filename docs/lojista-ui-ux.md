# Especificação de UI/UX — Lojista no Foundry

## Objetivo e usuário

A configuração é exclusiva do mestre conector ativo. Ela associa exatamente um
ator do mundo à fonte pública do catálogo exibido no portal e no Discord, sem
prometer compras, transferências ou edição externa do inventário.

## Hierarquia e fluxo

1. A seção aparece somente no estado conectado, depois da sincronização de
   personagens e antes da zona de desconexão.
2. O cabeçalho explica o propósito e mantém o selo “Somente consulta”.
3. O campo persistente “Ator do Lojista” lista atores reais em ordem alfabética
   e inclui a opção explícita “Nenhum ator selecionado”.
4. “Salvar Lojista” persiste o ID exato e, quando houver seleção, dispara o
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
- HTML é convertido para texto sanitizado. Caminhos locais de imagem não são
  publicados; o ícone vai como miniatura de 64 px gerada no navegador do mestre,
  até 15 000 caracteres por item e 800 000 por catálogo. Ícone que não carrega
  em até 5 s segue sem imagem.
- "Moeda dos preços sem moeda" fica logo abaixo do ator, com rótulo, ajuda
  associada por `aria-describedby` e as quatro moedas do sistema pelo nome.
  O valor padrão é centavos de cobre. Salvar o Lojista grava a moeda e reenvia
  o catálogo.
- Um preço só com número recebe a moeda escolhida (`22` vira `22 cp`); preços
  com moeda ou especiais seguem como escritos.

## Itens repetidos (0.13.0)

- **Usuário:** mestre que monta o estoque do Lojista arrastando itens.
- **Problema:** a ficha do sistema não mostra quantidade em armas; arrastar a
  mesma arma de novo criava uma cópia, e o portal listava as duas como itens
  diferentes.
- **Comportamento:** com "Lojista: somar itens repetidos" (configuração de
  mundo nas configurações do módulo, ligada por padrão), arrastar um item com
  o mesmo tipo e o mesmo nome (sem diferenciar acento e caixa) soma a
  quantidade do item arrastado no item que já existe. A cópia não é criada.
- **Feedback:** notificação informativa "{nome}: +{quantidade} no estoque do
  Lojista.", traduzida em pt-BR e en.
- **Escopo:** só no ator configurado como Lojista e só para o mestre que
  arrastou; itens criados pelo portal seguem o comando que os criou.
- **Cópias antigas:** juntadas na próxima sincronização, pelo mestre conector:
  fica a mais antiga, com a soma. Itens do portal e itens à mão não se
  misturam, para o sorteio continuar trocando só o que é do portal.

### Critérios de aceitação

- Arrastar duas vezes a mesma arma resulta em um item com quantidade 2 e uma
  notificação a cada soma.
- Arrastar um item do portal já existente o transforma em "colocado à mão".
- Desligar a opção volta ao comportamento do Foundry (cria a cópia).
- Jogadores e outros atores não são afetados.

### Pendência aceita

- A validação no Foundry real (arrastar do compêndio e da barra de itens,
  teclado e notificação) fica com o mestre ao instalar a 0.13.0; os testes
  automatizados cobrem a regra com documentos sintéticos.
