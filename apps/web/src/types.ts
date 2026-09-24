export type User = { id: string; username: string; role: 'ADMIN' | 'USER'; status: string };
export type PushService = { id: string; name: string; isEnabled: boolean; timeoutMs: number };
export type ChannelConfig = {
  id: string;
  serviceId: string;
  platform: string;
  configName: string;
  tags?: string;
  priority: number;
  isEnabled: boolean;
  configPayload?: Record<string, unknown>;
};
export type ApiKeyRow = {
  id: string;
  name: string;
  serviceName?: string;
  keyPrefix: string;
  status: string;
  expiresAt?: string;
};
export type TemplatePlatform = { platform: string; key: string; fieldCount: number };
export type TemplateField = {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  defaultValue?: unknown;
  description?: string;
  inputType?: string;
  repeat?: boolean;
  children?: TemplateField[];
};

export type Headers = { Authorization: string };
export type ResourceProps = { headers: Headers; reload: () => Promise<void> };
export type PushLog = {
  id: string;
  requestId: string;
  status: string;
  createdAt: string;
  errorMessage?: string;
};
