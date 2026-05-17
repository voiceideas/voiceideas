# Política de Privacidade — VoiceIdeas (DRAFT)

> **Status:** Rascunho técnico para revisão. NÃO é texto jurídico final
> e NÃO foi revisado por advogado. Para uso público, requer revisão
> jurídica e decisão do responsável (Gian) sobre onde hospedar
> (página `/privacy`, link no rodapé, etc).
>
> Versão draft: 1.0 · Data: 2026-05-17 · Ordem: `VI_LGPD_UNIFICATION`

---

## Quem somos

O VoiceIdeas é um app de captura de ideias por voz. Você grava sua fala,
o áudio é transcrito por IA e vira uma nota que você pode editar,
organizar e exportar.

Esta política descreve o que coletamos, por que coletamos, com quem
compartilhamos e como você pode controlar seus dados. Não usamos
termos jurídicos inflados. Quando algo é planejado mas ainda não está
ativo, deixamos claro.

---

## 1. Que dados tratamos

### 1.1 Para você usar o produto

- **Email** — para login (via link mágico ou Google) e recuperação de sessão.
- **Identificador único da sua conta** — gerado pelo sistema, usado internamente.
- **Texto das suas notas** — o que você grava ou digita.
- **Áudio gravado** — apenas se você ligar a opção "Salvar áudio para
  ouvir depois". Caso contrário o áudio é enviado para transcrição e
  descartado.
- **Tags, pastas e organização** — como você categoriza suas notas.

### 1.2 Para o produto funcionar e ser seguro

- **Logs técnicos** — registros de operações (gravação, transcrição,
  exportação) com seu identificador de conta, tipo de evento, IP e
  metadados não-sensíveis (tamanho do áudio, idioma, latência).
  Esses logs **não contêm** o conteúdo das suas notas, áudios, tokens
  ou senhas.
- **Métricas de uso de IA** — para aplicar limite diário e auditoria
  de custos.

### 1.3 Preferências locais

Algumas configurações ficam apenas no seu dispositivo (`localStorage`),
não em servidor:

- idioma preferido;
- modo de gravação padrão;
- toggle "Salvar áudio";
- estado intermediário de login OAuth (limpo após autenticar).

Nenhum cookie aplicacional é usado. Sessão é mantida via token JWT
guardado localmente pelo Supabase Auth.

---

## 2. Para que usamos seus dados

| Uso | Por quê |
|---|---|
| Autenticar você | sem isso o app não funciona |
| Salvar e exibir suas notas | é o serviço |
| Enviar seu áudio para transcrição por IA | é como a nota é criada |
| Salvar áudio para playback (opt-in) | só se você ligar o toggle |
| Organizar nota via "Fazer mágica" (IA) | só quando você clica no botão — é uma ação explícita sua |
| Exportar para Bardo | só quando você dispara o export |
| Registrar logs de segurança | detectar abuso, suportar você se algo der errado |
| Aplicar limite diário de IA | controle de uso para manter o produto sustentável |

---

## 3. Com quem compartilhamos

O VoiceIdeas usa serviços de terceiros para funcionar. Quando seus
dados passam por eles, isso está descrito aqui:

| Serviço | O que recebe | Para quê |
|---|---|---|
| **OpenAI** | seu áudio + idioma + prompt curto, para transcrever; sua transcrição + prompt, quando você usa "Fazer mágica" | gerar texto a partir do áudio; organizar a nota quando você pede |
| **Supabase** | tudo que está no nosso banco e storage (auth, notas, áudio retido se opt-in, logs) | infraestrutura: banco de dados, armazenamento, autenticação |
| **Vercel** | hospedagem do app web | servir as páginas |
| **Bardo (CENAX)** | título, texto, tags, e referência da nota que você decidir exportar; seu email para vincular contas | quando você dispara um export ou cria o vínculo |
| **Apple / Google** | dados de instalação do app nativo (geridos pelas lojas) | distribuição do app |

Cada um desses serviços tem sua própria política de privacidade.
Recomendamos a leitura para entender o que cada um faz com os dados:

- OpenAI: https://openai.com/policies/privacy-policy
- Supabase: https://supabase.com/privacy
- Vercel: https://vercel.com/legal/privacy-policy
- Bardo: ver política específica do produto Bardo
- App Store / Google Play: políticas das lojas

**Não vendemos seus dados para anunciantes. Não usamos suas notas
para treinar modelos de IA próprios.**

---

## 4. Por quanto tempo guardamos

Hoje, em produção:

| Tipo | Quanto tempo |
|---|---|
| Conta + notas + organização | enquanto você quiser. Você pode apagar notas individuais a qualquer momento na UI. |
| Áudio retido (toggle ON) | enquanto você não excluir. Você pode remover áudios individualmente ou a sessão inteira. **Não há deleção automática hoje.** |
| Logs técnicos | indefinidamente. Estamos avaliando uma política de cleanup automático. |
| Convites de compartilhamento de ideias | expiram automaticamente em 30 dias. |

Quando uma política de retenção automática for ativada, atualizaremos
este documento e avisaremos na app.

---

## 5. Seus direitos (LGPD art. 18)

Você tem direito a:

- **Saber quais dados temos sobre você** — pelo email de contato abaixo.
- **Corrigir dados** — você edita notas e organização diretamente na UI.
- **Apagar dados específicos** — você apaga notas, sessões de áudio
  e chunks individuais pela UI.
- **Apagar sua conta inteira** — atualmente isso requer solicitar pelo
  email de contato. Estamos implementando um botão "Apagar minha conta"
  no app.
- **Receber seus dados em formato estruturado (portabilidade)** —
  atualmente sob solicitação pelo email de contato. Estamos avaliando
  uma exportação automática.
- **Revogar consentimento** — você pode desligar o toggle "Salvar
  áudio" a qualquer momento. Áudios já gravados continuam até você
  excluí-los manualmente.

---

## 6. Segurança

Seu áudio fica em bucket privado no Supabase. Apenas você consegue
acessar via URL temporária (1 hora de validade) gerada quando você
clica em "Ouvir áudio". Todas as tabelas usam *Row Level Security*
para garantir que cada usuário só acessa os próprios dados.

Tokens de autenticação ficam no `localStorage` do seu dispositivo.
A comunicação com nossos servidores e com a OpenAI usa HTTPS.

Não armazenamos senhas — o login é por link mágico no email ou OAuth
do Google.

Nenhum sistema é 100% seguro. Se você suspeitar de uso indevido da
sua conta, escreva para o email de contato.

---

## 7. Crianças

VoiceIdeas não é direcionado para menores de 16 anos. Se você é
responsável e identificou que um menor criou conta, escreva para
o email de contato.

---

## 8. Mudanças nesta política

Atualizações materiais (mudança de provider, mudança de retenção,
novo compartilhamento) serão avisadas na app antes de entrar em vigor.
Pequenos ajustes de redação podem acontecer sem aviso ativo, mas
sempre com a data de revisão no topo deste documento.

---

## 9. Contato

Para qualquer solicitação relacionada aos seus dados pessoais (acesso,
correção, exclusão, portabilidade, revogação), escreva para:

`[email de contato a definir]`

Responderemos em até 15 dias úteis.

---

## Notas técnicas (para devs / não-públicas)

- Este draft foi gerado a partir do inventário `LGPD_DATA_MAP.md` e
  da auditoria `LGPD_COPY_AUDIT.md`.
- **Não é texto jurídico final.** Para publicação:
  1. Revisar com responsável legal (se houver) ou equivalente.
  2. Definir email de contato no §9.
  3. Decidir onde hospedar (`/privacy`, link em settings, link no
     rodapé do login).
  4. Adicionar `recorder.privacy.*` keys no i18n se decidir mencionar
     em algum modal.
- Quando TTL real de áudio for implementado, atualizar §4.
- Quando "Apagar minha conta" e "Exportar meus dados" forem
  implementados, atualizar §5.
