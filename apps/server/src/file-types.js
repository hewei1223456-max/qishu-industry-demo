// Native multipart uploaders may use octet-stream. Only explicit binary signatures qualify.
export function sniffMime(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  if (bytes.length >= 5 && bytes.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WAVE'
  )
    return 'audio/wav';
  if (bytes.length >= 3 && bytes.toString('ascii', 0, 3) === 'ID3') return 'audio/mpeg';
  if (
    bytes.length >= 4 &&
    bytes[0] === 255 &&
    (bytes[1] & 224) === 224 &&
    (bytes[1] & 24) !== 8 &&
    (bytes[1] & 6) !== 0 &&
    (bytes[2] & 240) !== 240 &&
    (bytes[2] & 12) !== 12
  )
    return 'audio/mpeg';
  return null;
}
