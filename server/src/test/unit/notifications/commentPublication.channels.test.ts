import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

describe('durable comment publication across channels', () => {
  afterEach(() => { vi.resetModules(); vi.restoreAllMocks(); });
  it('delivers the same event ID once per channel, including after the global channel completes', async () => {
    const sets = new Map<string,Set<string>>();
    const redis = Object.assign(new EventEmitter(), {
      connect: async () => { redis.emit('connect'); redis.emit('ready'); }, quit: async () => undefined,
      xAck: vi.fn(async()=>1), xGroupCreate: async()=>undefined,
      sIsMember: async(key:string,id:string)=>sets.get(key)?.has(id)||false,
      sAdd: async(key:string,id:string)=>{if(!sets.has(key))sets.set(key,new Set());sets.get(key)!.add(id);return 1;}, expire:async()=>1,
    });
    vi.doMock('redis',()=>({createClient:()=>redis}));
    const {EventBus}=await import('@/lib/eventBus');
    const bus=new EventBus();
    const event={id:randomUUID(),eventType:'TICKET_COMMENT_ADDED',timestamp:new Date().toISOString(),payload:{tenantId:randomUUID(),ticketId:randomUUID(),userId:randomUUID(),comment:{id:randomUUID(),content:'PDF attached',author:'Test',isInternal:false}}};
    const global=vi.fn(async()=>undefined), email=vi.fn(async()=>undefined), internal=vi.fn(async()=>undefined);
    for(const [channel,handler] of [['global',global],['emailservice::v7',email],['internal-notifications',internal],['emailservice::v7',email]] as const) {
      await (bus as any).processStreamMessage(redis,{eventBus:{consumerGroup:'test'}},channel,{channel,handlers:new Set([handler])},{id:'1-0',message:{event:JSON.stringify(event)}});
    }
    expect(global).toHaveBeenCalledOnce();expect(email).toHaveBeenCalledOnce();expect(internal).toHaveBeenCalledOnce();
    expect(redis.xAck).toHaveBeenCalledTimes(4);
    await bus.close();
  });
});
