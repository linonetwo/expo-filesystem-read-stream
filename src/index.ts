import { Buffer } from 'buffer';
import * as fs from 'expo-file-system/legacy';
import { Readable } from 'readable-stream';

/**
 * Options for creating an ExpoReadStream
 */
export interface ExpoReadStreamOptions {
  /**
   * Starting position in bytes (default: 0)
   */
  position?: number;
  /**
   * Chunk size in bytes for each read operation.
   * Default: 5MB (5 * 1024 * 1024)
   * 
   * React Native Expo may OOM at ~110MB, so default is 1/20 of that to balance 
   * speed and memory usage. Larger chunks improve throughput but may cause UI freezing;
   * smaller chunks waste time in filesystem handshakes.
   */
  chunkSize?: number;
  /**
   * Auto-initialize file size on first read (default: true)
   * If false, you must call init() manually before reading
   */
  autoInit?: boolean;
}

/**
 * Progress event data
 */
export interface ProgressEvent {
  /**
   * Progress ratio between 0 and 1
   */
  progress: number;
  /**
   * Current position in bytes
   */
  bytesRead: number;
  /**
   * Total file size in bytes
   */
  totalBytes: number;
}

/**
 * A readable stream for reading large files from Expo FileSystem.
 * Emits 'progress' events with completion ratio (0-1) as data is read.
 * 
 * @example
 * ```typescript
 * const stream = createReadStream('file:///path/to/file.txt');
 * stream.on('progress', (ratio) => console.log(`${(ratio * 100).toFixed(1)}%`));
 * stream.pipe(destinationStream);
 * ```
 * 
 * @example
 * ```typescript
 * const stream = createReadStream('file:///path/to/file.txt', { 
 *   chunkSize: 10 * 1024 * 1024, // 10MB chunks
 *   autoInit: false 
 * });
 * await stream.init();
 * stream.pipe(destinationStream);
 * ```
 */
export class ExpoReadStream extends Readable {
  private readonly fileUri: string;
  private fileSize: number;
  private currentPosition: number;
  private readonly chunkSize: number;
  private readonly autoInit: boolean;
  private initialized: boolean;
  private reading: boolean;
  private ended: boolean;

  constructor(fileUri: string, options: ExpoReadStreamOptions = {}) {
    super();
    this.fileUri = fileUri;
    this.fileSize = 0;
    this.currentPosition = options.position ?? 0;
    this.chunkSize = options.chunkSize ?? 1024 * 1024 * 5;
    this.autoInit = options.autoInit ?? true;
    this.initialized = false;
    this.reading = false;
    this.ended = false;
  }

  /**
   * Initialize the stream by fetching file metadata.
   * Must be called before reading if autoInit is false.
   * Safe to call multiple times (idempotent).
   * 
   * @returns The file size in bytes
   * @throws Error if file does not exist or cannot be accessed
   */
  public async init(): Promise<number> {
    if (this.initialized) {
      return this.fileSize;
    }

    try {
      const fileInfo = await fs.getInfoAsync(this.fileUri);
      if (!fileInfo.exists) {
        const error = new Error(`File does not exist: ${this.fileUri}`);
        this.destroy(error);
        throw error;
      }
      
      this.fileSize = fileInfo.size ?? 0;
      this.initialized = true;

      if (this.fileSize === 0) {
        console.warn(`[ExpoReadStream] File size is 0, path: ${this.fileUri}`);
      }

      return this.fileSize;
    } catch (error) {
      const wrappedError = error instanceof Error 
        ? error 
        : new Error(`Failed to initialize stream: ${String(error)}`);
      this.destroy(wrappedError);
      throw wrappedError;
    }
  }

  /**
   * Get current file size (only valid after init)
   */
  public getFileSize(): number {
    return this.fileSize;
  }

  /**
   * Get current read position
   */
  public getCurrentPosition(): number {
    return this.currentPosition;
  }

  /**
   * Internal read implementation called by Node.js stream
   */
  _read(): void {
    // Prevent concurrent reads
    if (this.reading || this.ended) {
      return;
    }

    this.reading = true;

    // Auto-initialize on first read if enabled
    if (!this.initialized && this.autoInit) {
      this.init()
        .then(() => this._doRead())
        .catch(error => {
          this.reading = false;
          // Error already handled in init()
        });
      return;
    }

    if (!this.initialized) {
      this.reading = false;
      const error = new Error('Stream not initialized. Call init() first or set autoInit: true');
      this.destroy(error);
      return;
    }

    this._doRead();
  }

  /**
   * Perform actual file read operation
   */
  private _doRead(): void {
    // Handle empty file
    if (this.fileSize === 0) {
      this.ended = true;
      this.reading = false;
      this.push(null);
      this.emit('progress', 1, {
        progress: 1,
        bytesRead: 0,
        totalBytes: 0,
      } as ProgressEvent);
      return;
    }

    // Check if we've reached EOF
    if (this.currentPosition >= this.fileSize) {
      this.ended = true;
      this.reading = false;
      this.push(null);
      this.emit('progress', 1, {
        progress: 1,
        bytesRead: this.fileSize,
        totalBytes: this.fileSize,
      } as ProgressEvent);
      return;
    }

    const readingOptions: fs.ReadingOptions = {
      encoding: fs.EncodingType.Base64,
      position: this.currentPosition,
      length: this.chunkSize,
    };

    fs.readAsStringAsync(this.fileUri, readingOptions)
      .then(base64Chunk => {
        this.reading = false;

        if (this.ended) {
          return;
        }

        if (base64Chunk.length === 0) {
          // Reached end of file
          this.ended = true;
          this.push(null);
          this.emit('progress', 1, {
            progress: 1,
            bytesRead: this.fileSize,
            totalBytes: this.fileSize,
          } as ProgressEvent);
          return;
        }

        try {
          const buffer = Buffer.from(base64Chunk, 'base64');
          this.currentPosition += buffer.length;
          
          const progress = this.currentPosition / this.fileSize;
          const progressEvent: ProgressEvent = {
            progress,
            bytesRead: this.currentPosition,
            totalBytes: this.fileSize,
          };

          this.push(buffer);
          this.emit('progress', progress, progressEvent);
        } catch (error) {
          const pushError = new Error(
            `Failed to push chunk to stream: ${(error as Error).message} ` +
            `(position: ${this.currentPosition}, fileSize: ${this.fileSize})`
          );
          this.destroy(pushError);
        }
      })
      .catch(error => {
        this.reading = false;
        const readError = new Error(
          `Failed to read file: ${(error as Error).message} ` +
          `(path: ${this.fileUri}, position: ${this.currentPosition})`
        );
        console.error(`[ExpoReadStream]`, readError);
        this.destroy(readError);
      });
  }
}

/**
 * Create a readable stream for an Expo FileSystem file URI.
 * 
 * @param fileUri - The file:// URI to read from
 * @param options - Optional configuration
 * @returns A readable stream instance
 * 
 * @example
 * ```typescript
 * import { createReadStream } from 'expo-filesystem-read-stream';
 * 
 * const stream = createReadStream('file:///path/to/large-file.zip');
 * 
 * stream.on('progress', (progress) => {
 *   console.log(`Progress: ${(progress * 100).toFixed(1)}%`);
 * });
 * 
 * stream.on('error', (error) => {
 *   console.error('Stream error:', error);
 * });
 * 
 * stream.pipe(someWritableStream);
 * ```
 */
export function createReadStream(
  fileUri: string, 
  options: ExpoReadStreamOptions = {}
): ExpoReadStream {
  return new ExpoReadStream(fileUri, options);
}
