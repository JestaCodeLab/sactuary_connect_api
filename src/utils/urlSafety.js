const isLocalHost = (url) => /localhost|127\.0\.0\.1/i.test(url || '');

// Catches the exact failure mode that shipped localhost QR codes into
// production: a process pointed at a live (non-local) database while its
// CLIENT_URL still holds a local dev value (e.g. a dev .env used to run a
// one-off script against a real MONGODB_URI). If the DB is remote but
// CLIENT_URL is local, something is misconfigured — refuse to bake that
// URL into anything persisted.
export function assertClientUrlMatchesDatabase(clientUrl, mongoUri) {
  if (isLocalHost(clientUrl) && !isLocalHost(mongoUri)) {
    throw new Error(
      `Refusing to use CLIENT_URL "${clientUrl}" because it points at localhost while MONGODB_URI points at a non-local database. ` +
      'Set CLIENT_URL to the correct public URL for this environment before generating check-in links.'
    );
  }
}
