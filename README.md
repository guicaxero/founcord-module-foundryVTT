# Ordem da Última Luz — Foundry Bridge

Módulo de conexão para mundos **Shadow of the Demon Lord** (`demonlord`) em
Foundry VTT 13 ou 14. A conexão é iniciada pelo navegador do mestre usando
HTTPS de saída; não é necessário abrir portas no roteador nem expor o Foundry.

## Instalação

No Foundry, abra **Add-on Modules → Install Module** e use o manifesto:

```text
https://github.com/guicaxero/founcord-module-foundryVTT/releases/latest/download/module.json
```

O Foundry usará esse endereço estável para instalar e detectar atualizações.

### Instalação manual

Baixe `ordem-foundry-bridge.zip` na release mais recente e extraia seu conteúdo
em `Data/modules/ordem-foundry-bridge/`.

### Instalação de desenvolvimento

O código-fonte é TypeScript em `src/` e precisa ser compilado com
[Bun](https://bun.sh):

```bash
bun install
bun run build
```

O build gera `dist/ordem-foundry-bridge/`. Copie ou crie um link simbólico dessa
pasta em `Data/modules/ordem-foundry-bridge` e ative o módulo no mundo da
campanha. Antes de abrir um Pull Request, execute `bun run check`.

Ao entrar no mundo pela primeira vez, o módulo informa que está ativo mas ainda
não conectado. Esse aviso é esperado: ativação e registro seguro são etapas
separadas.

## Conectar um mundo

1. Entre no mundo como mestre e abra **Configurações → Configurar módulos →
   Ordem da Última Luz → Gerenciar conexão**.
2. Selecione **Conectar este mundo**. O módulo exibirá um código temporário com
   validade de dez minutos.
3. Abra o portal pelo botão da própria tela e entre com o Discord.
4. Escolha uma das campanhas que você tem permissão para gerenciar, revise os
   dados do mundo e autorize.
5. Volte ao Foundry. A tela detecta a autorização, envia o primeiro heartbeat e
   sincroniza os personagens automaticamente.

Não há token administrativo, ID de campanha ou comando de console. O portal
aplica o RBAC no servidor: `owner` pode escolher qualquer campanha; mestre ou
gerente escolhe somente uma campanha em que tenha esse papel; jogador e usuário
comum não podem autorizar. O código temporário não é uma credencial permanente,
expira rapidamente e nunca é mostrado depois da conexão.

## Operação

- a conexão existe somente enquanto o mestre conector está no mundo; sem ele o
  mundo aparece offline no portal e nenhuma requisição é feita;
- heartbeat na cadência definida pelo Bridge (60 segundos), com offline
  derivado após 150 segundos sem heartbeat;
- polling de comandos adaptativo: 5 segundos após receber comandos, dobrando a
  cada ciclo vazio até 30 segundos, com backoff em falhas;
- sincronização integral dos personagens ao iniciar e após alterações;
- catálogo somente leitura do ator escolhido como Mercador, atualizado ao
  iniciar e depois de alterações no ator ou em seus itens;
- pedidos assistidos do portal revalidados no mundo e notificados somente aos
  mestres, sem movimentação automática de moedas, estoque ou inventário;
- captura somente de mensagens públicas durante sessões iniciadas pelo portal;
- fila local de até 500 mensagens públicas para reenvio após indisponibilidade;
- o navegador do mestre que concluiu o pareamento mantém a conexão; outro
  mestre pode iniciar um novo pareamento quando necessário.

O módulo não sincroniza descrições, notas do mestre, inventário ou conteúdo de
livros. Somente nome, nível, ancestralidade, caminhos, proprietários, recursos
mecânicos mínimos, o saldo das quatro moedas (`system.wealth`) e miniaturas do
retrato e do token do personagem são enviados ao portal.

### Configurar o Mercador

Com o mundo conectado, abra **Gerenciar conexão**, localize a seção
**Mercador**, escolha o ator que representa o estoque e selecione **Salvar
Mercador**. O primeiro catálogo é enviado imediatamente. Alterações futuras no
ator e em seus itens agendam novas sincronizações; o mestre também pode usar
**Sincronizar catálogo**.

O catálogo é uma projeção pública: envia no máximo 500 itens com nome,
descrição sanitizada, categoria, preço, quantidade, raridade, tipo de
consumível, propriedades, dados de arma e armadura e uma miniatura de 64 px do
ícone, gerada no navegador do mestre. Caminhos locais do Foundry, flags, notas
de mestre e demais dados do ator não são enviados. Preços digitados só com
número recebem a moeda escolhida em **Moeda dos preços sem moeda**.

### Estoque sorteado pelo portal

No painel do portal, **Estoque do Lojista** sorteia itens do catálogo da
campanha. Ao confirmar o envio, o módulo recebe o comando
`merchant.stock.replace` e cria os itens no ator do Mercador. Só os itens de
sorteios anteriores são substituídos (eles levam uma marca do módulo); o que o
mestre colocou à mão continua no ator. Reenviar o mesmo sorteio não duplica
itens. Sem o mestre conectado, o envio espera na fila do Bridge.

### Criaturas montadas no portal

Na área **Criaturas** do painel, o mestre monta uma criatura a partir do
bestiário importado ou do zero. Ao enviar, o módulo recebe o comando
`creature.upsert` e cria o ator na pasta **Ordem — Criaturas**. Reenviar
atualiza o mesmo ator (ele leva uma marca do módulo): atributos,
características e os itens criados pelo portal são substituídos, e itens
colocados à mão continuam. Nenhuma macro ou código é executado, e as
descrições chegam como texto simples.

Pedidos feitos no portal aparecem como sussurros para os mestres depois que o
módulo revalida personagem, item, preço e estoque. Eles continuam sendo pedidos:
o mestre realiza o acerto no Foundry e registra a decisão no portal. Esta versão
não realiza transferência de itens ou desconto de moedas.

Durante uma sessão registrada no portal, o mestre conector envia uma projeção
em texto simples das mensagens públicas do chat. Sussurros, rolagens cegas,
mensagens privadas e HTML não são enviados. Fora de uma captura ativa, o Bridge
descarta os lotes recebidos e o módulo remove esses itens da fila local.

## API local do módulo

```js
const bridge = game.modules.get("ordem-foundry-bridge").api
bridge.status()
await bridge.syncNow()
await bridge.syncMerchant()
await bridge.disconnect()
bridge.open()
```
