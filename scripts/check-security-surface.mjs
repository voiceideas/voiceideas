import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(relativePath) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

function assertIncludes(haystack, needle, message) {
  if (!haystack.includes(needle)) {
    throw new Error(message)
  }
}

function assertExcludes(haystack, needle, message) {
  if (haystack.includes(needle)) {
    throw new Error(message)
  }
}

const organizeFunction = read('supabase/functions/organize/index.ts')
const transcribeFunction = read('supabase/functions/transcribe/index.ts')
const shareIdeaFunction = read('supabase/functions/share-idea/index.ts')
const previewInviteFunction = read('supabase/functions/preview-idea-invite/index.ts')
const organizeClient = read('src/lib/organize.ts')
const transcribeClient = read('src/lib/transcribe.ts')

assertIncludes(organizeFunction, 'assertDailyAiQuota', 'organize must enforce daily AI quota')
assertIncludes(organizeFunction, 'assertBusinessRateLimit', 'organize must enforce business rate limit')
assertExcludes(organizeFunction, 'systemPrompt', 'organize must not accept free-form systemPrompt from the client')
assertExcludes(organizeFunction, 'typeLabel', 'organize must not accept free-form typeLabel from the client')

assertIncludes(transcribeFunction, 'MAX_FILE_BYTES', 'transcribe must enforce max file size')
assertIncludes(transcribeFunction, 'assertDailyAiQuota', 'transcribe must enforce daily AI quota')
assertExcludes(transcribeFunction, "formData.get('prompt')", 'transcribe must not accept client prompt')

assertExcludes(shareIdeaFunction, 'signInWithOtp', 'share-idea must not use OTP delivery anymore')
assertIncludes(shareIdeaFunction, '.from(\'idea_invites\')', 'share-idea must persist internal invite tokens')

assertIncludes(previewInviteFunction, 'recipientEmailMasked', 'invite preview must expose masked email only')
assertExcludes(previewInviteFunction, 'recipientEmail:', 'invite preview must not expose raw email')

assertExcludes(organizeClient, 'systemPrompt', 'client organize helper must not send systemPrompt')
assertExcludes(organizeClient, 'typeLabel,', 'client organize helper must not send typeLabel')
assertExcludes(transcribeClient, "formData.append(\n    'prompt'", 'client transcribe helper must not send prompt')

console.log('Verified hardened client/server security surfaces for organize, transcribe, and sharing.')
