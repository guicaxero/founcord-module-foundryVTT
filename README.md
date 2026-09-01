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

Copie a pasta `ordem-foundry-bridge` para `Data/modules/` da instalação do
Foundry e ative o módulo no mundo da campanha.

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

- heartbeat a cada 30 segundos;
- offline derivado após 90 segundos sem heartbeat;
- polling de comandos a cada 5 segundos, com backoff em falhas;
- sincronização integral dos personagens ao iniciar e após alterações;
- catálogo somente leitura do ator escolhido como Mercador, atualizado ao
  iniciar e depois de alterações no ator ou em seus itens;
- captura somente de mensagens públicas durante sessões iniciadas pelo portal;
- fila local de até 500 mensagens públicas para reenvio após indisponibilidade;
- o navegador do mestre que concluiu o pareamento mantém a conexão; outro
  mestre pode iniciar um novo pareamento quando necessário.

O módulo não sincroniza descrições, notas do mestre, inventário ou conteúdo de
livros. Somente nome, nível, ancestralidade, caminhos, proprietários e recursos
mecânicos mínimos são enviados ao portal.

### Configurar o Mercador

Com o mundo conectado, abra **Gerenciar conexão**, localize a seção
**Mercador**, escolha o ator que representa o estoque e selecione **Salvar
Mercador**. O primeiro catálogo é enviado imediatamente. Alterações futuras no
ator e em seus itens agendam novas sincronizações; o mestre também pode usar
**Sincronizar catálogo**.

O catálogo é uma projeção pública somente leitura: envia no máximo 500 itens
com nome, descrição sanitizada, categoria, preço, quantidade e, quando já for
pública, uma URL HTTPS de imagem. Caminhos locais do Foundry, flags, notas de
mestre e demais dados do ator não são enviados. Esta versão não realiza compra,
transferência de itens ou desconto de moedas.

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
