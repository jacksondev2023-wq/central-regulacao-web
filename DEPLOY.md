# Deploy da Central de Regulação

## Opção recomendada agora: Railway

Como o dashboard do Render não abriu nesta rede, use Railway. O arquivo `railway.json` define:

- build: `npm ci && npm run build`
- start: `npm start`
- health check: `/api/health`
- restart automático em falha

No Railway, adicione um banco PostgreSQL ao mesmo projeto e configure a variável `DATABASE_URL` no serviço web apontando para o PostgreSQL. Quando `DATABASE_URL` existe, a aplicação usa PostgreSQL automaticamente. Se a tabela ainda não existir, o servidor cria `app_state` e importa a base inicial de `server/data/central-regulacao.json` no primeiro start.

## Passos

1. Acesse `https://railway.com`.
2. Crie um New Project.
3. Escolha Deploy from GitHub repo.
4. Selecione `jacksondev2023-wq/central-regulacao-web`.
5. Depois que o serviço web for criado, clique em New > Database > Add PostgreSQL.
6. No serviço web, abra Variables e adicione `DATABASE_URL` referenciando o banco PostgreSQL.
7. Garanta também `NODE_ENV=production`.
8. Gere/abra o domínio público do serviço web.
9. Teste `/api/health`; precisa retornar `storage: "postgres"`.

## Alternativa: Render

O `render.yaml` continua no repositório como alternativa. Ele cria Web Service + PostgreSQL via Blueprint. Use quando o dashboard do Render voltar a abrir na sua rede.

## Acessos iniciais

- Atendentes e reguladores usam PIN `1234` neste piloto.
- Todos conseguem ver o Painel operacional e o Relatório diário.
- Reguladores podem editar e organizar a fila completa.
- Atendentes registram e editam seus próprios atendimentos.

## Banco de dados

A primeira versão usa PostgreSQL com uma tabela documental:

```sql
app_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null
)
```

Isso permite colocar em produção rapidamente com persistência real. A evolução recomendada é normalizar em tabelas dedicadas para `users`, `patients`, `attendances`, `handovers` e `audit_logs`.

## Cuidados antes de liberar para operação real

- Trocar os PINs padrão por senhas individuais.
- Manter o repositório privado, pois a base inicial tem nomes de pacientes.
- Revisar políticas internas de LGPD antes de expor fora da rede corporativa.
- Ativar backup do PostgreSQL no provedor.
- Evolução recomendada: senhas com hash, perfis administrativos e auditoria mais granular.
