export interface MediaFile {
  path: string;
  name: string;
  type: 'image' | 'video' | 'audio' | 'file' | 'license';
}
export interface PlatformResponse {
  statusCode: number;
  data: unknown;
}
export interface PlatformAdapter {
  request(options: {
    url: string;
    method?: string;
    data?: unknown;
    timeout?: number;
    header?: Record<string, string>;
  }): Promise<PlatformResponse>;
  upload(options: {
    url: string;
    filePath: string;
    name: string;
    formData?: Record<string, string>;
    header?: Record<string, string>;
  }): Promise<PlatformResponse>;
  read(key: string): unknown;
  write(key: string, value: unknown): void;
  remove(key: string): void;
  font(): number;
  open(url: string): Promise<unknown>;
  tab(url: string): Promise<unknown>;
  back(fallback?: string): Promise<unknown>;
  title(title: string): void;
  toast(message: string): void;
  copy(data: string): Promise<unknown>;
  preview(current: string, urls: string[]): Promise<unknown>;
  confirm(title: string, content: string): Promise<{ confirm: boolean; cancel: boolean }>;
  login(): Promise<{ code: string }>;
  choose(kind: MediaFile['type']): Promise<MediaFile>;
  record(): Promise<MediaFile>;
  stopRecord(): void;
  playAudio(url: string): Promise<unknown>;
  stopAudio(): void;
  scrollTop(): void;
}

// 此接口定义不是抖音或原生 App 的已完成实现。
export type TargetPlatform = 'wechat' | 'web' | 'douyin' | 'native';
