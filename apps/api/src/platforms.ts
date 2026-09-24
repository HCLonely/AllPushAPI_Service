const aliases: Record<string, string> = {
  钉钉群机器人: 'dingtalk',
  飞书群机器人: 'feishu',
  爱语飞飞: 'iyuu',
  'QQ 官方机器人': 'qqbot',
  'Server 酱 Turbo': 'serverchanturbo',
  企业微信: 'workweixin',
  企业微信群机器人: 'workweixinbot',
  息知: 'xizhi',
  一封传话: 'yifengchuanhua'
};
const supported = new Set(
  'serverchanturbo serverchan pushdeer telegrambot dingtalk wxpusher mail feishu workweixin pushplus showdoc xizhi discord gocqhttp qmsg workweixinbot chanify bark googlechat push slack pushback zulip rocketchat pushover iyuu ntfy notifyx yifengchuanhua wpush pushbullet simplepush pushme qqbot'.split(
    ' '
  )
);
export function platformKey(value: string) {
  return (
    aliases[value.trim()] ||
    value
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, '')
  );
}
export function isSupportedPlatform(value: string) {
  return supported.has(platformKey(value));
}
