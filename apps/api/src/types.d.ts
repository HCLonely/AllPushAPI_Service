declare module 'all-pusher-api' {
  export class PushApi {
    constructor(configs: Array<{ name: string; config: any }>);
    send(options: any): Promise<Array<{ name: string; result: { status: number; statusText: string; extraMessage: any } }>>;
  }
}
