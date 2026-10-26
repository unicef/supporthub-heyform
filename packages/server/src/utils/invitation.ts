export function normalizeInvitationRecipients(
  submittedEmails: string[],
  existingEmails: string[]
): string[] {
  const existing = new Set(existingEmails.map(email => email.trim().toLowerCase()))

  return Array.from(
    new Set(
      submittedEmails.map(email => email.trim().toLowerCase()).filter(email => !existing.has(email))
    )
  )
}
