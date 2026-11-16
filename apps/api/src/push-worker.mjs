import { parentPort, workerData } from 'node:worker_threads';
import dns from 'node:dns';
import net from 'node:net';
import ipaddr from 'ipaddr.js';

// Install the guard before loading SDK transports. Check both literal IPs and
// the actual DNS lookup results used by sockets, including redirected requests.
const privateAllowed = process.env.ALLOW_PRIVATE_NETWORK === 'true';
const isPublic = (address) => {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
};
if (!privateAllowed) {
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'])
    delete process.env[key];
  const lookup = dns.lookup;
  dns.lookup = function (hostname, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    return lookup.call(dns, hostname, options ?? {}, (error, address, family) => {
      if (error) return callback(error);
      const addresses = Array.isArray(address) ? address.map((v) => v.address) : [address];
      if (addresses.some((v) => !isPublic(v))) return callback(new Error('Private network access denied'));
      callback(null, address, family);
    });
  };
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const options =
      typeof first === 'object'
        ? first
        : { port: first, host: typeof args[1] === 'string' ? args[1] : 'localhost' };
    const host = options.host || options.hostname || 'localhost';
    if (options.path || (net.isIP(host) && !isPublic(host)) || /^localhost\.?$/i.test(host)) {
      throw new Error('Private network access denied');
    }
    return connect.apply(this, args);
  };
}

// 只提取固定诊断和数值状态，不序列化 SDK 错误中的令牌、请求头或 URL。
function goCqhttpMessage(result) {
  const message = String(result.statusText || '推送失败');
  const detail = result.extraMessage;
  if (result.status === 102) {
    if ([detail?.message, detail?.cause?.message].includes('Private network access denied')) {
      return `${message}: 内网访问被禁止；受信任部署请设置 ALLOW_PRIVATE_NETWORK=true 并重启服务`;
    }
    const httpStatus = detail?.response?.status;
    if (Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599) {
      const hint = httpStatus === 401 || httpStatus === 403
        ? '；请检查 NapCat HTTP 服务的 token 和访问权限'
        : httpStatus === 404
          ? '；请检查 baseUrl 是否指向 HTTP API 根地址，SDK 会自动追加 /send_msg'
          : '';
      return `${message}: HTTP ${httpStatus}${hint}`;
    }
    const hints = {
      ECONNREFUSED: '连接被拒绝，请检查 HTTP 服务是否启动及地址、端口是否正确',
      ENOTFOUND: '域名无法解析，请检查 HTTP 服务地址',
      EAI_AGAIN: 'DNS 解析暂时失败',
      ETIMEDOUT: '连接超时，请检查网络和防火墙',
      ECONNABORTED: '请求超时或被中止',
      ECONNRESET: '连接被重置，请检查 HTTP 服务及代理',
      ERR_INVALID_URL: 'HTTP 服务地址无效',
      ERR_TLS_CERT_ALTNAME_INVALID: 'HTTPS 证书与域名不匹配',
      DEPTH_ZERO_SELF_SIGNED_CERT: 'HTTPS 使用了不受信任的自签名证书'
    };
    for (const code of [detail?.code, detail?.cause?.code]) {
      if (Object.hasOwn(hints, code)) {
        return `${message}: ${code}；${hints[code]}`;
      }
    }
  }
  const retcode = detail?.data?.retcode;
  if (result.status !== 200 && Number.isInteger(retcode)) {
    return `${message}: OneBot retcode=${retcode}；请检查 NapCat 日志及目标账号、群号`;
  }
  return message;
}

try {
  const { PushApi } = await import('all-pusher-api');
  const { platform, config } = workerData;
  if (!privateAllowed && config.proxy?.enable) throw new Error('Proxy access disabled');
  const options = { ...workerData.options };
  // Nodemailer options supplied by API callers must never load server files/URLs.
  if (platform.toLowerCase() === 'mail') {
    // Restrict untrusted transport configuration to SMTP. Nodemailer also accepts
    // sendmail/json/stream transports and executable paths, which are not channels.
    const smtp = config.key || {};
    config.key = {
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.auth,
      requireTLS: smtp.requireTLS,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
      disableFileAccess: true,
      disableUrlAccess: true
    };
    options.extraOptions = { ...options.extraOptions, disableFileAccess: true, disableUrlAccess: true };
  }
  const results = await new PushApi([{ name: platform, config }]).send(options);
  const result = results?.[0]?.result;
  // SDK responses contain Axios request headers, URLs with tokens and sockets.
  // Persist only the normalized status; never serialize the transport response.
  parentPort.postMessage(
    result
      ? {
          status: result.status,
          message: platform.toLowerCase() === 'gocqhttp'
            ? goCqhttpMessage(result)
            : String(result.statusText || '推送失败')
        }
      : { message: '不支持的平台或没有投递结果' }
  );
} catch {
  parentPort.postMessage({ message: '平台配置无效或目标网络不可访问' });
}
