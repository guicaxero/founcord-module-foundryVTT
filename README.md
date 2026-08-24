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

## Registro do mundo

1. Em **Configurações do módulo**, confira a URL do Bridge e o ID da campanha.
2. Solicite ao administrador um token temporário de registro.
3. Como mestre, abra o console do navegador e execute:

```js
await game.modules
  .get("ordem-foundry-bridge")
  .api.registerWorld("TOKEN_TEMPORARIO")
```

O token temporário não é salvo e só pode ser utilizado uma vez. O Bridge devolve
uma credencial aleatória para aquele navegador do mestre, armazenada como
configuração local e nunca exibida em logs. Para repetir o registro e rotacionar
a credencial anterior, solicite um novo token de bootstrap.

## Operação

- heartbeat a cada 30 segundos;
- offline derivado após 90 segundos sem heartbeat;
- polling de comandos a cada 5 segundos, com backoff em falhas;
- sincronização integral dos personagens ao iniciar e após alterações;
- apenas o primeiro mestre ativo mantém a conexão, evitando duplicidade.

O módulo não sincroniza descrições, notas do mestre, inventário ou conteúdo de
livros. Somente nome, nível, ancestralidade, caminhos, proprietários e recursos
mecânicos mínimos são enviados ao portal.

## API local do módulo

```js
const bridge = game.modules.get("ordem-foundry-bridge").api
bridge.status()
await bridge.syncNow()
await bridge.disconnect()
```
