// JPEG uploads are untrusted. Validate size and SOI signature; never execute or interpret as HTML/SVG.

export const MAX_JPEG_BYTES = 5 * 1024 * 1024;

export function isJpegBuffer(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= 3
    && buffer[0] === 0xFF
    && buffer[1] === 0xD8
    && buffer[2] === 0xFF;
}

export function decodeJpegBase64(input, { contentType } = {}) {
  if (contentType != null && contentType !== 'image/jpeg') {
    const error = new Error('Only image/jpeg uploads are accepted.');
    error.code = 'INVALID_IMAGE_TYPE';
    throw error;
  }
  if (typeof input !== 'string' || input.length === 0) {
    const error = new Error('A JPEG result image is required.');
    error.code = 'MISSING_JPEG';
    throw error;
  }

  let payload = input;
  if (payload.startsWith('data:')) {
    const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(payload);
    if (!match) {
      const error = new Error('Malformed JPEG data URL.');
      error.code = 'MALFORMED_JPEG';
      throw error;
    }
    if (match[1] !== 'image/jpeg') {
      const error = new Error('Only image/jpeg uploads are accepted.');
      error.code = 'INVALID_IMAGE_TYPE';
      throw error;
    }
    payload = match[2];
  }

  let buffer;
  try {
    buffer = Buffer.from(payload, 'base64');
  } catch {
    const error = new Error('Malformed JPEG encoding.');
    error.code = 'MALFORMED_JPEG';
    throw error;
  }

  if (!buffer.length) {
    const error = new Error('A JPEG result image is required.');
    error.code = 'MISSING_JPEG';
    throw error;
  }
  if (buffer.length > MAX_JPEG_BYTES) {
    const error = new Error(`JPEG exceeds the maximum size of ${MAX_JPEG_BYTES} bytes.`);
    error.code = 'JPEG_TOO_LARGE';
    throw error;
  }
  if (!isJpegBuffer(buffer)) {
    const error = new Error('Upload is not a valid JPEG image.');
    error.code = 'MALFORMED_JPEG';
    throw error;
  }
  return buffer;
}
