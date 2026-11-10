export function isSupplierCertificate(application) {
  return (
    application.applicantRole === 'supplier' ||
    application.role === 'supplier' ||
    !!application.venueVideoFileId ||
    application.venuePhotoFileIds?.length > 0 ||
    application.missingFields?.some((value) => /场所|视频|照片|电话/.test(String(value))) ||
    false
  );
}

export function certificateReviewPath(roleOrApplication, { status = '', query = '' } = {}) {
  const supplier =
    typeof roleOrApplication === 'string'
      ? roleOrApplication === 'supplier'
      : isSupplierCertificate(roleOrApplication);
  const params = new URLSearchParams({ tab: supplier ? 'supplier-certifications' : 'owner-certifications' });
  if (status) params.set('status', status);
  if (query) params.set('query', query);
  return '/admin/users?' + params;
}

export function certificateReviewSelection(query = new URLSearchParams()) {
  return {
    role: query.get('tab') === 'owner-certifications' ? 'owner' : 'supplier',
    status: query.get('status') || '',
    query: (query.get('query') || '').trim()
  };
}

export function filterCertificateReviews(applications, selection) {
  return applications.filter((application) => {
    if (isSupplierCertificate(application) !== (selection.role === 'supplier')) return false;
    if (selection.status && application.status !== selection.status) return false;
    const text = [application.company, application.scope, application.ownerId].join(' ').toLowerCase();
    return !selection.query || text.includes(selection.query.toLowerCase());
  });
}
