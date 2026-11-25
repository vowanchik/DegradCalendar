function serverOrigin(value) {
  if (typeof value !== 'string') throw new Error('Invalid server address');
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Invalid server address');
  return url.origin;
}

module.exports = { serverOrigin };
