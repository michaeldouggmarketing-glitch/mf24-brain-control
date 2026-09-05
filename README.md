# MF24 Brain Control Center

Projeto independente para controle, API e observabilidade da inteligência do MF24. O ledger continua exclusivamente em `meu-financeiro-24h-prod`; conhecimento e telemetria vivem no schema isolado `mf24_brain` de `aqualax-command-prod`.

## Fluxo

Inteligência nativa → memória particular → conhecimento global → IA econômica → IA avançada → validação → confirmação → executor autorizado.

## API

- `GET /api/v1/health`
- `GET /api/v1/dashboard` (somente status e métricas agregadas)
- `GET /api/v1/identity` (somente claims não secretos do OIDC da Vercel)
- `POST /api/v1/brain/preview` (sem escrita no ledger; usado pelo teste do painel)
- `POST /api/v1/brain/interpret`
- `POST /api/v1/channels/whatsapp/message`
- `POST /api/v1/audio/transcribe`

Endpoints de escrita exigem `Authorization: Bearer <key>` ou `X-API-Key`. A chave é comparada somente por SHA-256 com `MF24_API_KEY_HASH`; nunca é armazenada no código.

O painel consulta a Edge Function `mf24-brain-core` com a chave publicável do Supabase. Essa chave não concede acesso de serviço: ações administrativas continuam exigindo JWT `service_role`, e o RPC de inventário agregado é revogado para `anon` e `authenticated`.

### Áudio

`POST /api/v1/audio/transcribe` aceita JSON com `audio_url` HTTPS ou `audio_base64`, `mime_type`, `duration_ms`, `filename` e `channel`. O arquivo é validado, limitado, transcrito no servidor e descartado; somente hash, tamanho, duração, modelo, latência e resultado operacional podem ser registrados em `audio_events`. O retorno contém transcrição, interpretação e prévia, nunca uma escrita automática no ledger.

### n8n

Envie ao endpoint WhatsApp: `event_id`, `phone`, `message_type`, `text` ou `audio_url`, e `timestamp`. Reutilize o mesmo `event_id` em retries. O retorno informa `duplicate` e `idempotency_persistence`. Com `MF24_BRAIN_SERVICE_ROLE_KEY`, a deduplicação persiste por 24 horas no Supabase; sem ela, o fallback é efêmero por instância. O endpoint nunca grava diretamente no ledger.

## Segurança

Segredos apenas no ambiente, CSP e cabeçalhos defensivos, payload limitado, rate limit, idempotência, hash de telefone e entrada, confirmação obrigatória e zero retenção de áudio bruto.

## Testes

`npm test`
