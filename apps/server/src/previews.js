export function createMediaPreviews(db, secrets) {
  const lifetime = 10 * 60 * 1000;
  function urlFor(file, scope = 'generated') {
    const expiresAt = Date.now() + lifetime;
    const ticket = secrets.encrypt(
      JSON.stringify({ kind: 'media-preview', scope, fileId: file.id, ownerId: file.ownerId, expiresAt })
    );
    return {
      url: `/api/files/${file.id}?ticket=${encodeURIComponent(ticket)}`,
      expiresAt: new Date(expiresAt).toISOString()
    };
  }
  function present(job) {
    if (!job?.result?.fileId) return job;
    const file = db.get('files', job.result.fileId);
    if (!file || file.public || file.purpose !== 'generated' || file.ownerId !== job.ownerId) return job;
    const preview = urlFor(file);
    return { ...job, result: { ...job.result, url: preview.url, previewExpiresAt: preview.expiresAt } };
  }
  function permits(file, ticket) {
    if (!ticket || !file || !['generated', 'contact'].includes(file.purpose) || ticket.length > 2000)
      return false;
    try {
      const data = JSON.parse(secrets.decrypt(ticket));
      if (
        data.kind !== 'media-preview' ||
        data.fileId !== file.id ||
        data.ownerId !== file.ownerId ||
        !Number.isFinite(data.expiresAt) ||
        data.expiresAt <= Date.now() ||
        data.expiresAt > Date.now() + lifetime + 5000
      )
        return false;
      if (file.purpose === 'generated') return data.scope === 'generated';
      const owner = db.get('users', file.ownerId);
      return (
        owner &&
        !['deleted', 'disabled', 'revoked', 'suspended'].includes(owner.status) &&
        owner.publicContact?.qrUrl === `/api/files/${file.id}` &&
        (data.scope === 'owner-contact' ||
          (data.scope === 'contact' && owner.verified && owner.contactConsent === true))
      );
    } catch {
      return false;
    }
  }
  return { present, permits, urlFor };
}
