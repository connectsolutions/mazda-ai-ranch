import { Readable } from 'stream';

export interface IS3FileLocation {
  bucket: string;
  key: string;
}

export interface IS3UploadInput extends IS3FileLocation {
  body: Buffer;
  contentType: string;
}

export interface IS3StoredFile extends IS3FileLocation {
  uri: string;
}

/**
 * A GetObject body left as a stream so large files can be piped to an HTTP
 * response without ever being held whole in memory.
 */
export interface IS3ObjectStream {
  body: Readable;
  contentType: string | null;
  contentLength: number | null;
}

export class S3RepositoryError extends Error {
  constructor(
    message: string,
    public readonly bucket?: string,
    public readonly key?: string,
  ) {
    super(message);
    this.name = 'S3RepositoryError';
  }
}
