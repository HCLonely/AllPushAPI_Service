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
      ? { status: result.status, message: String(result.statusText || '推送失败') }
      : { message: '不支持的平台或没有投递结果' }
  );
} catch {
  parentPort.postMessage({ message: '平台配置无效或目标网络不可访问' });
}
