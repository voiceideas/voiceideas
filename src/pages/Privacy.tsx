/**
 * VI_LGPD_PRIVACY_POLICY_PUBLISH (2026-05-17)
 *
 * Página pública /privacy. NÃO está sob AuthGate — qualquer visitante
 * pode acessar (incluindo crawlers, leitor externo via link de loja
 * de apps, etc).
 *
 * Conteúdo:
 *   - 3 locales completos (pt-BR, en, es) renderizados a partir de
 *     `useI18n().locale`.
 *   - 9 seções espelhando `docs/PRIVACY_POLICY_DRAFT.md`.
 *   - Linguagem direta, sem inflação jurídica, sem promessa de
 *     "100% LGPD compliant".
 *   - Quando algo é planejado mas ainda não está ativo, deixa claro.
 *
 * Email de contato: privacidade.vi@agenciacapitolio.com.br
 *
 * O componente NÃO depende de markdown renderer — JSX direto + classes
 * Tailwind. Locale seguindo o user pref (LanguageProvider). Botão
 * "Voltar" usa navigate(-1) com fallback para '/'.
 */
import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../hooks/useI18n'
import type { AppLocale } from '../lib/i18n'

const PRIVACY_CONTACT_EMAIL = 'privacidade.vi@agenciacapitolio.com.br'
const LAST_UPDATED_ISO = '2026-05-17'

// ─── Conteúdo por locale ────────────────────────────────────────────

interface PolicyContent {
  pageTitle: string
  intro: string[]
  sections: Array<{
    title: string
    paragraphs: Array<string | ReactNode>
  }>
  footerNote: string
  lastUpdatedLabel: (date: string) => string
}

function renderPtBr(): PolicyContent {
  return {
    pageTitle: 'Política de Privacidade',
    intro: [
      'O VoiceIdeas é um app de captura de ideias por voz. Você grava sua fala, o áudio é transcrito por inteligência artificial e vira uma nota que você pode editar, organizar e exportar.',
      'Esta política descreve o que coletamos, por que coletamos, com quem compartilhamos e como você pode controlar seus dados. Não usamos termos jurídicos inflados. Quando algo é planejado mas ainda não está ativo, deixamos claro.',
    ],
    sections: [
      {
        title: '1. Quais dados tratamos',
        paragraphs: [
          'Para você usar o produto:',
          <ul className="list-disc pl-6 space-y-1" key="data-product">
            <li><strong>Email</strong> — para login (via link mágico ou Google) e recuperação de sessão.</li>
            <li><strong>Identificador único da sua conta</strong> — gerado pelo sistema, usado internamente.</li>
            <li><strong>Texto das suas notas</strong> — o que você grava ou digita.</li>
            <li><strong>Áudio gravado</strong> — apenas se você ligar a opção "Salvar áudio para ouvir depois". Caso contrário o áudio é enviado para transcrição e descartado.</li>
            <li><strong>Tags, pastas e organização</strong> — como você categoriza suas notas.</li>
          </ul>,
          'Para o produto funcionar e ser seguro:',
          <ul className="list-disc pl-6 space-y-1" key="data-tech">
            <li><strong>Logs técnicos</strong> — registros de operações (gravação, transcrição, exportação) com seu identificador de conta, tipo de evento, IP e metadados não-sensíveis (tamanho do áudio, idioma, latência). Esses logs <strong>não contêm</strong> o conteúdo das suas notas, áudios, tokens ou senhas.</li>
            <li><strong>Métricas de uso de IA</strong> — para aplicar limite diário e auditoria de custos.</li>
          </ul>,
          'Preferências locais (apenas no seu dispositivo, via localStorage):',
          <ul className="list-disc pl-6 space-y-1" key="data-local">
            <li>idioma preferido</li>
            <li>modo de gravação padrão</li>
            <li>toggle "Salvar áudio"</li>
            <li>estado intermediário de login OAuth (limpo após autenticar)</li>
          </ul>,
          'Nenhum cookie aplicacional é usado. A sessão é mantida via token JWT guardado localmente pelo Supabase Auth.',
        ],
      },
      {
        title: '2. Para que usamos seus dados',
        paragraphs: [
          <ul className="list-disc pl-6 space-y-1" key="purpose">
            <li><strong>Autenticar você</strong> — sem isso o app não funciona.</li>
            <li><strong>Salvar e exibir suas notas</strong> — é o serviço.</li>
            <li><strong>Enviar seu áudio para transcrição por IA</strong> — é como a nota é criada.</li>
            <li><strong>Salvar áudio para playback (opt-in)</strong> — só se você ligar o toggle.</li>
            <li><strong>Organizar nota via "Fazer mágica" (IA)</strong> — só quando você clica no botão; é uma ação explícita sua.</li>
            <li><strong>Exportar para Bardo</strong> — só quando você dispara o export.</li>
            <li><strong>Registrar logs de segurança</strong> — detectar abuso, suportar você se algo der errado.</li>
            <li><strong>Aplicar limite diário de IA</strong> — controle de uso para manter o produto sustentável.</li>
          </ul>,
        ],
      },
      {
        title: '3. Com quem compartilhamos',
        paragraphs: [
          'O VoiceIdeas usa serviços de terceiros para funcionar. Quando seus dados passam por eles, isso está descrito aqui:',
          <ul className="list-disc pl-6 space-y-2" key="providers">
            <li><strong>OpenAI</strong> — recebe seu áudio + idioma + prompt curto, para transcrever; recebe sua transcrição + prompt, quando você usa "Fazer mágica". Política: <a href="https://openai.com/policies/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">openai.com/policies/privacy-policy</a></li>
            <li><strong>Supabase</strong> — armazena tudo que está em nosso banco e storage (auth, notas, áudio retido se opt-in, logs). Política: <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">supabase.com/privacy</a></li>
            <li><strong>Vercel</strong> — hospedagem do app web. Política: <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">vercel.com/legal/privacy-policy</a></li>
            <li><strong>Bardo</strong> — recebe título, texto, tags e referência da nota que você decidir exportar; recebe seu email para vincular contas. Apenas quando você dispara um export ou cria o vínculo.</li>
            <li><strong>Apple / Google</strong> — dados de instalação do app nativo são geridos pelas lojas.</li>
          </ul>,
          <p key="not-sell" className="font-medium text-slate-800">
            Não vendemos seus dados para anunciantes. Não usamos suas notas para treinar modelos de IA próprios.
          </p>,
        ],
      },
      {
        title: '4. Por quanto tempo guardamos',
        paragraphs: [
          'Hoje, em produção:',
          <ul className="list-disc pl-6 space-y-1" key="retention">
            <li><strong>Conta + notas + organização</strong>: enquanto você quiser. Você pode apagar notas individuais a qualquer momento na UI.</li>
            <li><strong>Áudio retido (toggle ON)</strong>: enquanto você não excluir. Você pode remover áudios individualmente ou a sessão inteira. <strong>Não há deleção automática hoje.</strong></li>
            <li><strong>Logs técnicos</strong>: indefinidamente. Estamos avaliando uma política de cleanup automático.</li>
            <li><strong>Convites de compartilhamento de ideias</strong>: expiram automaticamente em 30 dias.</li>
          </ul>,
          'Quando uma política de retenção automática for ativada, atualizaremos este documento e avisaremos na app.',
        ],
      },
      {
        title: '5. Seus direitos (LGPD art. 18)',
        paragraphs: [
          'Você tem direito a:',
          <ul className="list-disc pl-6 space-y-1" key="rights">
            <li><strong>Saber quais dados temos sobre você</strong> — pelo email de contato abaixo.</li>
            <li><strong>Corrigir dados</strong> — você edita notas e organização diretamente na UI.</li>
            <li><strong>Apagar dados específicos</strong> — você apaga notas, sessões de áudio e chunks individuais pela UI.</li>
            <li><strong>Apagar sua conta inteira</strong> — atualmente isso requer solicitar pelo email de contato. Estamos implementando um botão "Apagar minha conta" no app.</li>
            <li><strong>Receber seus dados em formato estruturado (portabilidade)</strong> — atualmente sob solicitação pelo email de contato. Estamos avaliando uma exportação automática.</li>
            <li><strong>Revogar consentimento</strong> — você pode desligar o toggle "Salvar áudio" a qualquer momento. Áudios já gravados continuam até você excluí-los manualmente.</li>
          </ul>,
        ],
      },
      {
        title: '6. Segurança',
        paragraphs: [
          'Seu áudio fica em bucket privado no Supabase. Apenas você consegue acessar via URL temporária (1 hora de validade) gerada quando você clica em "Ouvir áudio". Todas as tabelas usam Row Level Security para garantir que cada usuário só acessa os próprios dados.',
          'Tokens de autenticação ficam no localStorage do seu dispositivo. A comunicação com nossos servidores e com a OpenAI usa HTTPS.',
          'Não armazenamos senhas — o login é por link mágico no email ou OAuth do Google.',
          'Nenhum sistema é 100% seguro. Se você suspeitar de uso indevido da sua conta, escreva para o email de contato.',
        ],
      },
      {
        title: '7. Crianças',
        paragraphs: [
          'VoiceIdeas não é direcionado para menores de 16 anos. Se você é responsável e identificou que um menor criou conta, escreva para o email de contato.',
        ],
      },
      {
        title: '8. Mudanças nesta política',
        paragraphs: [
          'Atualizações materiais (mudança de provider, mudança de retenção, novo compartilhamento) serão avisadas na app antes de entrar em vigor.',
          'Pequenos ajustes de redação podem acontecer sem aviso ativo, mas sempre com a data de revisão no topo deste documento.',
        ],
      },
      {
        title: '9. Contato',
        paragraphs: [
          'Para qualquer solicitação relacionada aos seus dados pessoais (acesso, correção, exclusão, portabilidade, revogação), escreva para:',
          <p key="contact-email" className="font-mono text-base font-medium text-slate-800">
            <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="text-primary hover:underline">
              {PRIVACY_CONTACT_EMAIL}
            </a>
          </p>,
          'Responderemos em até 15 dias úteis.',
        ],
      },
    ],
    footerNote:
      'Este documento está em revisão contínua. Para sugestões de clareza, escreva no mesmo email acima.',
    lastUpdatedLabel: (date) => `Última atualização: ${date}`,
  }
}

function renderEn(): PolicyContent {
  return {
    pageTitle: 'Privacy Policy',
    intro: [
      'VoiceIdeas is a voice-first idea capture app. You record your speech, the audio is transcribed by AI and becomes a note you can edit, organize and export.',
      "This policy describes what we collect, why we collect it, who we share with and how you can control your data. We don't use inflated legalese. When something is planned but not yet active, we say so clearly.",
    ],
    sections: [
      {
        title: '1. What data we process',
        paragraphs: [
          'To let you use the product:',
          <ul className="list-disc pl-6 space-y-1" key="data-product-en">
            <li><strong>Email</strong> — for login (magic link or Google) and session recovery.</li>
            <li><strong>Your account unique ID</strong> — generated by the system, used internally.</li>
            <li><strong>Your notes text</strong> — what you record or type.</li>
            <li><strong>Recorded audio</strong> — only if you turn on the "Save audio for later" toggle. Otherwise the audio is sent for transcription and discarded.</li>
            <li><strong>Tags, folders and organization</strong> — how you categorize your notes.</li>
          </ul>,
          'For the product to function and be secure:',
          <ul className="list-disc pl-6 space-y-1" key="data-tech-en">
            <li><strong>Technical logs</strong> — operation records (recording, transcription, export) with your account ID, event type, IP and non-sensitive metadata (audio size, language, latency). These logs <strong>do not contain</strong> your notes content, audio, tokens or passwords.</li>
            <li><strong>AI usage metrics</strong> — to apply daily limits and audit costs.</li>
          </ul>,
          'Local preferences (only on your device, via localStorage):',
          <ul className="list-disc pl-6 space-y-1" key="data-local-en">
            <li>preferred language</li>
            <li>default recording mode</li>
            <li>"Save audio" toggle</li>
            <li>intermediate OAuth login state (cleared after authentication)</li>
          </ul>,
          'No application cookies are used. The session is maintained via JWT token stored locally by Supabase Auth.',
        ],
      },
      {
        title: '2. Why we use your data',
        paragraphs: [
          <ul className="list-disc pl-6 space-y-1" key="purpose-en">
            <li><strong>Authenticate you</strong> — without this the app doesn't work.</li>
            <li><strong>Save and display your notes</strong> — it is the service.</li>
            <li><strong>Send your audio for AI transcription</strong> — that's how a note is created.</li>
            <li><strong>Save audio for playback (opt-in)</strong> — only if you turn on the toggle.</li>
            <li><strong>Organize a note via "Make magic" (AI)</strong> — only when you click the button; it's your explicit action.</li>
            <li><strong>Export to Bardo</strong> — only when you trigger the export.</li>
            <li><strong>Record security logs</strong> — detect abuse, support you if something goes wrong.</li>
            <li><strong>Apply daily AI limit</strong> — usage control to keep the product sustainable.</li>
          </ul>,
        ],
      },
      {
        title: '3. Who we share with',
        paragraphs: [
          'VoiceIdeas uses third-party services to function. When your data passes through them, it is described here:',
          <ul className="list-disc pl-6 space-y-2" key="providers-en">
            <li><strong>OpenAI</strong> — receives your audio + language + short prompt for transcription; receives your transcript + prompt when you use "Make magic". Policy: <a href="https://openai.com/policies/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">openai.com/policies/privacy-policy</a></li>
            <li><strong>Supabase</strong> — stores everything in our database and storage (auth, notes, retained audio if opt-in, logs). Policy: <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">supabase.com/privacy</a></li>
            <li><strong>Vercel</strong> — hosting for the web app. Policy: <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">vercel.com/legal/privacy-policy</a></li>
            <li><strong>Bardo</strong> — receives title, text, tags and reference of the note you choose to export; receives your email to link accounts. Only when you trigger an export or create the link.</li>
            <li><strong>Apple / Google</strong> — native app install data is managed by the stores.</li>
          </ul>,
          <p key="not-sell-en" className="font-medium text-slate-800">
            We do not sell your data to advertisers. We do not use your notes to train our own AI models.
          </p>,
        ],
      },
      {
        title: '4. How long we keep it',
        paragraphs: [
          'Today, in production:',
          <ul className="list-disc pl-6 space-y-1" key="retention-en">
            <li><strong>Account + notes + organization</strong>: as long as you want. You can delete individual notes at any time in the UI.</li>
            <li><strong>Retained audio (toggle ON)</strong>: until you delete it. You can remove audios individually or the whole session. <strong>There is no automatic deletion today.</strong></li>
            <li><strong>Technical logs</strong>: indefinitely. We are evaluating an automatic cleanup policy.</li>
            <li><strong>Idea share invites</strong>: expire automatically in 30 days.</li>
          </ul>,
          'When an automatic retention policy is activated, we will update this document and notify in the app.',
        ],
      },
      {
        title: '5. Your rights (LGPD art. 18)',
        paragraphs: [
          'You have the right to:',
          <ul className="list-disc pl-6 space-y-1" key="rights-en">
            <li><strong>Know what data we have about you</strong> — through the contact email below.</li>
            <li><strong>Correct data</strong> — you edit notes and organization directly in the UI.</li>
            <li><strong>Delete specific data</strong> — you delete notes, audio sessions and individual chunks via the UI.</li>
            <li><strong>Delete your entire account</strong> — currently requires request via the contact email. We are implementing a "Delete my account" button in the app.</li>
            <li><strong>Receive your data in structured format (portability)</strong> — currently on request via the contact email. We are evaluating automatic export.</li>
            <li><strong>Revoke consent</strong> — you can turn off the "Save audio" toggle at any time. Audios already recorded remain until you delete them manually.</li>
          </ul>,
        ],
      },
      {
        title: '6. Security',
        paragraphs: [
          'Your audio lives in a private Supabase bucket. Only you can access it via temporary URL (1-hour validity) generated when you click "Play audio". All tables use Row Level Security to ensure each user only accesses their own data.',
          'Authentication tokens stay in your device localStorage. Communication with our servers and OpenAI uses HTTPS.',
          'We do not store passwords — login is via magic link in your email or Google OAuth.',
          'No system is 100% secure. If you suspect misuse of your account, write to the contact email.',
        ],
      },
      {
        title: '7. Children',
        paragraphs: [
          'VoiceIdeas is not directed at children under 16. If you are a guardian and identified that a minor created an account, write to the contact email.',
        ],
      },
      {
        title: '8. Changes to this policy',
        paragraphs: [
          'Material updates (provider change, retention change, new sharing) will be announced in the app before taking effect.',
          'Small wording adjustments may happen without active notice, but always with the revision date at the top of this document.',
        ],
      },
      {
        title: '9. Contact',
        paragraphs: [
          'For any request related to your personal data (access, correction, deletion, portability, revocation), write to:',
          <p key="contact-email-en" className="font-mono text-base font-medium text-slate-800">
            <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="text-primary hover:underline">
              {PRIVACY_CONTACT_EMAIL}
            </a>
          </p>,
          'We will respond within 15 business days.',
        ],
      },
    ],
    footerNote:
      'This document is under continuous review. For clarity suggestions, write to the same email above.',
    lastUpdatedLabel: (date) => `Last updated: ${date}`,
  }
}

function renderEs(): PolicyContent {
  return {
    pageTitle: 'Política de Privacidad',
    intro: [
      'VoiceIdeas es una app de captura de ideas por voz. Tú grabas tu habla, el audio es transcrito por inteligencia artificial y se convierte en una nota que puedes editar, organizar y exportar.',
      'Esta política describe qué recopilamos, por qué lo recopilamos, con quién compartimos y cómo puedes controlar tus datos. No usamos términos jurídicos inflados. Cuando algo está planificado pero aún no está activo, lo decimos claramente.',
    ],
    sections: [
      {
        title: '1. Qué datos tratamos',
        paragraphs: [
          'Para que uses el producto:',
          <ul className="list-disc pl-6 space-y-1" key="data-product-es">
            <li><strong>Email</strong> — para login (vía enlace mágico o Google) y recuperación de sesión.</li>
            <li><strong>Identificador único de tu cuenta</strong> — generado por el sistema, usado internamente.</li>
            <li><strong>Texto de tus notas</strong> — lo que grabas o escribes.</li>
            <li><strong>Audio grabado</strong> — solo si activas el toggle "Guardar audio para escuchar después". De lo contrario el audio se envía para transcripción y se descarta.</li>
            <li><strong>Etiquetas, carpetas y organización</strong> — cómo categorizas tus notas.</li>
          </ul>,
          'Para que el producto funcione y sea seguro:',
          <ul className="list-disc pl-6 space-y-1" key="data-tech-es">
            <li><strong>Logs técnicos</strong> — registros de operaciones (grabación, transcripción, exportación) con tu identificador de cuenta, tipo de evento, IP y metadatos no sensibles (tamaño del audio, idioma, latencia). Estos logs <strong>no contienen</strong> el contenido de tus notas, audios, tokens o contraseñas.</li>
            <li><strong>Métricas de uso de IA</strong> — para aplicar límite diario y auditoría de costos.</li>
          </ul>,
          'Preferencias locales (solo en tu dispositivo, vía localStorage):',
          <ul className="list-disc pl-6 space-y-1" key="data-local-es">
            <li>idioma preferido</li>
            <li>modo de grabación predeterminado</li>
            <li>toggle "Guardar audio"</li>
            <li>estado intermedio de login OAuth (limpiado después de autenticar)</li>
          </ul>,
          'No se usan cookies aplicacionales. La sesión se mantiene vía token JWT guardado localmente por Supabase Auth.',
        ],
      },
      {
        title: '2. Para qué usamos tus datos',
        paragraphs: [
          <ul className="list-disc pl-6 space-y-1" key="purpose-es">
            <li><strong>Autenticarte</strong> — sin esto la app no funciona.</li>
            <li><strong>Guardar y mostrar tus notas</strong> — es el servicio.</li>
            <li><strong>Enviar tu audio para transcripción por IA</strong> — es como se crea la nota.</li>
            <li><strong>Guardar audio para playback (opt-in)</strong> — solo si activas el toggle.</li>
            <li><strong>Organizar nota vía "Hacer magia" (IA)</strong> — solo cuando haces clic; es una acción explícita tuya.</li>
            <li><strong>Exportar a Bardo</strong> — solo cuando disparas el export.</li>
            <li><strong>Registrar logs de seguridad</strong> — detectar abuso, soportarte si algo sale mal.</li>
            <li><strong>Aplicar límite diario de IA</strong> — control de uso para mantener el producto sostenible.</li>
          </ul>,
        ],
      },
      {
        title: '3. Con quién compartimos',
        paragraphs: [
          'VoiceIdeas usa servicios de terceros para funcionar. Cuando tus datos pasan por ellos, está descrito aquí:',
          <ul className="list-disc pl-6 space-y-2" key="providers-es">
            <li><strong>OpenAI</strong> — recibe tu audio + idioma + prompt corto, para transcribir; recibe tu transcripción + prompt cuando usas "Hacer magia". Política: <a href="https://openai.com/policies/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">openai.com/policies/privacy-policy</a></li>
            <li><strong>Supabase</strong> — almacena todo lo que está en nuestra base de datos y storage (auth, notas, audio retenido si opt-in, logs). Política: <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">supabase.com/privacy</a></li>
            <li><strong>Vercel</strong> — hosting del app web. Política: <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">vercel.com/legal/privacy-policy</a></li>
            <li><strong>Bardo</strong> — recibe título, texto, etiquetas y referencia de la nota que decidas exportar; recibe tu email para vincular cuentas. Solo cuando disparas un export o creas el vínculo.</li>
            <li><strong>Apple / Google</strong> — datos de instalación del app nativo son gestionados por las tiendas.</li>
          </ul>,
          <p key="not-sell-es" className="font-medium text-slate-800">
            No vendemos tus datos a anunciantes. No usamos tus notas para entrenar modelos de IA propios.
          </p>,
        ],
      },
      {
        title: '4. Por cuánto tiempo guardamos',
        paragraphs: [
          'Hoy, en producción:',
          <ul className="list-disc pl-6 space-y-1" key="retention-es">
            <li><strong>Cuenta + notas + organización</strong>: mientras tú quieras. Puedes eliminar notas individuales en cualquier momento en la UI.</li>
            <li><strong>Audio retenido (toggle ON)</strong>: mientras no lo elimines. Puedes remover audios individualmente o la sesión completa. <strong>No hay eliminación automática hoy.</strong></li>
            <li><strong>Logs técnicos</strong>: indefinidamente. Estamos evaluando una política de cleanup automático.</li>
            <li><strong>Invitaciones de compartir ideas</strong>: expiran automáticamente en 30 días.</li>
          </ul>,
          'Cuando una política de retención automática sea activada, actualizaremos este documento y avisaremos en la app.',
        ],
      },
      {
        title: '5. Tus derechos (LGPD art. 18)',
        paragraphs: [
          'Tienes derecho a:',
          <ul className="list-disc pl-6 space-y-1" key="rights-es">
            <li><strong>Saber qué datos tenemos sobre ti</strong> — por el email de contacto abajo.</li>
            <li><strong>Corregir datos</strong> — editas notas y organización directamente en la UI.</li>
            <li><strong>Eliminar datos específicos</strong> — eliminas notas, sesiones de audio y chunks individuales por la UI.</li>
            <li><strong>Eliminar tu cuenta entera</strong> — actualmente requiere solicitar por el email de contacto. Estamos implementando un botón "Eliminar mi cuenta" en la app.</li>
            <li><strong>Recibir tus datos en formato estructurado (portabilidad)</strong> — actualmente bajo solicitud por el email de contacto. Estamos evaluando una exportación automática.</li>
            <li><strong>Revocar consentimiento</strong> — puedes apagar el toggle "Guardar audio" en cualquier momento. Audios ya grabados continúan hasta que los elimines manualmente.</li>
          </ul>,
        ],
      },
      {
        title: '6. Seguridad',
        paragraphs: [
          'Tu audio queda en bucket privado de Supabase. Solo tú puedes accederlo vía URL temporal (1 hora de validez) generada cuando haces clic en "Escuchar audio". Todas las tablas usan Row Level Security para garantizar que cada usuario solo accede a sus propios datos.',
          'Tokens de autenticación quedan en el localStorage de tu dispositivo. La comunicación con nuestros servidores y con OpenAI usa HTTPS.',
          'No almacenamos contraseñas — el login es por enlace mágico en email u OAuth de Google.',
          'Ningún sistema es 100% seguro. Si sospechas uso indebido de tu cuenta, escribe al email de contacto.',
        ],
      },
      {
        title: '7. Niños',
        paragraphs: [
          'VoiceIdeas no está dirigido a menores de 16 años. Si eres responsable e identificaste que un menor creó cuenta, escribe al email de contacto.',
        ],
      },
      {
        title: '8. Cambios en esta política',
        paragraphs: [
          'Actualizaciones materiales (cambio de proveedor, cambio de retención, nuevo compartir) serán avisadas en la app antes de entrar en vigor.',
          'Pequeños ajustes de redacción pueden ocurrir sin aviso activo, pero siempre con la fecha de revisión arriba de este documento.',
        ],
      },
      {
        title: '9. Contacto',
        paragraphs: [
          'Para cualquier solicitud relacionada a tus datos personales (acceso, corrección, eliminación, portabilidad, revocación), escribe a:',
          <p key="contact-email-es" className="font-mono text-base font-medium text-slate-800">
            <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="text-primary hover:underline">
              {PRIVACY_CONTACT_EMAIL}
            </a>
          </p>,
          'Responderemos en hasta 15 días hábiles.',
        ],
      },
    ],
    footerNote:
      'Este documento está en revisión continua. Para sugerencias de claridad, escribe al mismo email arriba.',
    lastUpdatedLabel: (date) => `Última actualización: ${date}`,
  }
}

function resolveContent(locale: AppLocale): PolicyContent {
  if (locale === 'en') return renderEn()
  if (locale === 'es') return renderEs()
  return renderPtBr()
}

// ─── Page component ────────────────────────────────────────────────

export function Privacy() {
  const navigate = useNavigate()
  const { locale, formatDate } = useI18n()
  const content = resolveContent(locale)

  const handleBack = () => {
    const historyIndex = window.history.state?.idx
    if (typeof historyIndex === 'number' && historyIndex > 0) {
      navigate(-1)
      return
    }
    navigate('/')
  }

  const lastUpdatedFormatted = formatDate(LAST_UPDATED_ISO, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 sm:py-14">
      <div className="mx-auto max-w-3xl">
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
        >
          <ArrowLeft className="h-4 w-4" />
          {locale === 'en'
            ? 'Back'
            : locale === 'es'
              ? 'Volver'
              : 'Voltar'}
        </button>

        <article className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-10 shadow-sm">
          <header className="mb-8 border-b border-slate-200 pb-6">
            <h1 className="text-3xl font-semibold text-slate-900">
              {content.pageTitle}
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              {content.lastUpdatedLabel(lastUpdatedFormatted)}
            </p>
          </header>

          <div className="space-y-6 text-base leading-relaxed text-slate-700">
            {content.intro.map((paragraph, index) => (
              <p key={`intro-${index}`}>{paragraph}</p>
            ))}
          </div>

          <div className="mt-10 space-y-10">
            {content.sections.map((section) => (
              <section key={section.title} className="space-y-4">
                <h2 className="text-xl font-semibold text-slate-900">
                  {section.title}
                </h2>
                <div className="space-y-3 text-base leading-relaxed text-slate-700">
                  {section.paragraphs.map((paragraph, index) =>
                    typeof paragraph === 'string' ? (
                      <p key={`p-${index}`}>{paragraph}</p>
                    ) : (
                      <div key={`p-${index}`}>{paragraph}</div>
                    ),
                  )}
                </div>
              </section>
            ))}
          </div>

          <footer className="mt-12 border-t border-slate-200 pt-6 text-sm text-slate-500">
            {content.footerNote}
          </footer>
        </article>
      </div>
    </div>
  )
}
