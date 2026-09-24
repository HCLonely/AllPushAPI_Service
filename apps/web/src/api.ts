import axios from 'axios';
export const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api', timeout: 15000 });
export const getApiErrorMessage = (error: unknown, fallback = '请求失败') => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as any;
    if (typeof data?.message === 'string' && data.message.trim()) return data.message;
    if (Array.isArray(data?.issues) && data.issues.length) {
      const firstIssue = data.issues[0];
      if (typeof firstIssue?.message === 'string' && firstIssue.message.trim()) return firstIssue.message;
    }
    if (typeof error.message === 'string' && error.message.trim()) return error.message;
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
};
