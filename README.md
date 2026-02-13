# expo-filesystem-read-stream

[![npm version](https://badge.fury.io/js/expo-filesystem-read-stream.svg)](https://www.npmjs.com/package/expo-filesystem-read-stream)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A readable stream implementation for reading large files from Expo FileSystem with progress tracking. Designed to handle large files without causing out-of-memory errors in React Native Expo apps.

Refactored from old version of [TidGi-Mobile](https://github.com/tiddly-gittly/TidGi-Mobile/) at <https://github.com/tiddly-gittly/TidGi-Mobile/blob/e121fab04e0279d954c21c797f4023212b2ece33/src/services/ImportService/ExpoReadStream.ts>

## Features

- 📦 **Stream-based reading**: Read large files chunk-by-chunk without loading entire file into memory
- 📊 **Progress tracking**: Built-in progress events with detailed metrics
- 🔒 **Memory safe**: Default 5MB chunks prevent OOM on React Native (which typically crashes at ~110MB)
- ⚡ **Auto-initialization**: Lazy initialization or manual init() for full control
- 🛡️ **Robust error handling**: Comprehensive error messages and proper stream destruction
- 📝 **TypeScript**: Full type definitions included

## Installation

```bash
npm install expo-filesystem-read-stream
```

or

```bash
yarn add expo-filesystem-read-stream
```

### Peer Dependencies

This package requires `expo-file-system` as a peer dependency:

```bash
npx expo install expo-file-system
```

## Usage

### Basic Usage

```typescript
import { createReadStream } from 'expo-filesystem-read-stream';
import * as FileSystem from 'expo-file-system';

// Create a stream (auto-initializes on first read)
const stream = createReadStream(FileSystem.documentDirectory + 'large-file.zip');

// Listen for progress events
stream.on('progress', (progress, event) => {
  console.log(`Progress: ${(progress * 100).toFixed(1)}%`);
  console.log(`Read ${event.bytesRead} of ${event.totalBytes} bytes`);
});

// Handle errors
stream.on('error', (error) => {
  console.error('Stream error:', error);
});

// Pipe to destination
stream.pipe(writableStream);
```

### Manual Initialization

```typescript
import { createReadStream } from 'expo-filesystem-read-stream';

const stream = createReadStream('file:///path/to/file.dat', {
  autoInit: false  // Disable auto-initialization
});

// Initialize manually to get file size before reading
const fileSize = await stream.init();
console.log(`File size: ${fileSize} bytes`);

// Now you can start reading
stream.pipe(destinationStream);
```

### Custom Chunk Size

```typescript
import { createReadStream } from 'expo-filesystem-read-stream';

// Use 10MB chunks for faster reading (if memory allows)
const stream = createReadStream('file:///path/to/file.bin', {
  chunkSize: 10 * 1024 * 1024  // 10MB
});

stream.pipe(destinationStream);
```

### Reading from Specific Position

```typescript
import { createReadStream } from 'expo-filesystem-read-stream';

// Start reading from byte 1000
const stream = createReadStream('file:///path/to/file.txt', {
  position: 1000
});

stream.pipe(destinationStream);
```

### Using with React Native Progress Bar

```typescript
import { createReadStream } from 'expo-filesystem-read-stream';
import { useState } from 'react';
import { ProgressBar } from 'react-native-paper';

function FileReader() {
  const [progress, setProgress] = useState(0);
  const [bytesRead, setBytesRead] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);

  const readFile = async () => {
    const stream = createReadStream('file:///path/to/large-file.zip');
    
    stream.on('progress', (_, event) => {
      setProgress(event.progress);
      setBytesRead(event.bytesRead);
      setTotalBytes(event.totalBytes);
    });

    stream.on('error', (error) => {
      console.error('Error:', error);
    });

    // Process the stream...
    stream.pipe(processingStream);
  };

  return (
    <>
      <ProgressBar progress={progress} />
      <Text>{bytesRead} / {totalBytes} bytes</Text>
    </>
  );
}
```

## API

### `createReadStream(fileUri, options?)`

Creates a new readable stream for the specified file.

**Parameters:**

- `fileUri` (string): The file:// URI to read from
- `options` (ExpoReadStreamOptions, optional): Configuration options

**Returns:** `ExpoReadStream` - A readable stream instance

### `ExpoReadStreamOptions`

```typescript
interface ExpoReadStreamOptions {
  /**
   * Starting position in bytes (default: 0)
   */
  position?: number;
  
  /**
   * Chunk size in bytes for each read operation.
   * Default: 5MB (5 * 1024 * 1024)
   */
  chunkSize?: number;
  
  /**
   * Auto-initialize file size on first read (default: true)
   * If false, you must call init() manually before reading
   */
  autoInit?: boolean;
}
```

### `ExpoReadStream` Class

#### Methods

##### `init(): Promise<number>`

Initialize the stream by fetching file metadata. Must be called before reading if `autoInit` is false. Safe to call multiple times (idempotent).

**Returns:** Promise resolving to file size in bytes

**Throws:** Error if file does not exist or cannot be accessed

##### `getFileSize(): number`

Get current file size (only valid after initialization).

##### `getCurrentPosition(): number`

Get current read position in bytes.

#### Events

##### `'progress'`

Emitted after each chunk is read successfully.

**Callback signature:**

```typescript
(progress: number, event: ProgressEvent) => void
```

**ProgressEvent:**

```typescript
interface ProgressEvent {
  progress: number;    // Progress ratio between 0 and 1
  bytesRead: number;   // Current position in bytes
  totalBytes: number;  // Total file size in bytes
}
```

##### `'error'`

Emitted when an error occurs during reading.

**Callback signature:**

```typescript
(error: Error) => void
```

##### `'end'`

Emitted when the stream has finished reading the entire file.

##### Standard Node.js Stream Events

ExpoReadStream extends Node.js `Readable` stream, so all standard stream events are available: `'data'`, `'readable'`, `'close'`, etc.

## Performance Considerations

### Chunk Size

The default chunk size is 5MB, which is 1/20 of the typical React Native memory limit (~110MB). This balances:

- **Throughput**: Larger chunks = fewer filesystem operations = faster reading
- **Memory usage**: Smaller chunks = lower peak memory usage
- **UI responsiveness**: Smaller chunks = more frequent progress updates, less UI freezing

Adjust `chunkSize` based on your needs:

- **Small files (<50MB)**: Use default 5MB or increase to 10MB
- **Large files (>100MB)**: Keep default 5MB or reduce to 2-3MB if memory is tight
- **Background processing**: Can use larger chunks (10-20MB) if UI responsiveness is not critical

### Memory Safety

React Native apps typically crash when memory usage exceeds ~110MB. This package helps by:

1. Reading files in small chunks instead of loading entire file
2. Allowing backpressure (stream automatically pauses if downstream is slow)
3. Cleaning up chunks after they're consumed

## Error Handling

The stream properly handles various error scenarios:

- **File not found**: Throws error during `init()`
- **Read failures**: Emits 'error' event with descriptive message
- **Empty files**: Handles gracefully, emits 100% progress immediately
- **Interrupted reads**: Properly destroys stream on errors

Always attach an error handler:

```typescript
stream.on('error', (error) => {
  console.error('Stream error:', error.message);
  // Clean up resources, show user message, etc.
});
```

## Troubleshooting

### "Stream not initialized" error

Call `init()` manually if `autoInit` is false:

```typescript
const stream = createReadStream(uri, { autoInit: false });
await stream.init();  // Must call this first
stream.pipe(destination);
```

### Out of memory errors

Reduce chunk size:

```typescript
const stream = createReadStream(uri, {
  chunkSize: 2 * 1024 * 1024  // 2MB instead of 5MB
});
```

### Progress events not firing

Make sure to consume the stream (pipe it or attach 'data' listener):

```typescript
stream.on('data', (chunk) => {
  // Process chunk
});

stream.on('progress', (progress) => {
  console.log(progress);  // Now this will fire
});
```

## License

MIT © [linonetwo](https://github.com/linonetwo)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Related Projects

- [expo-file-system](https://docs.expo.dev/versions/latest/sdk/filesystem/) - Expo's file system API
- [readable-stream](https://github.com/nodejs/readable-stream) - Node.js streams in userland
