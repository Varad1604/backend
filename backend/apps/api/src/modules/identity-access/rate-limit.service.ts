import { HttpException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { RedisService } from '../../infra/redis/redis.service';
// Brief §3: login 5/min per IP+username; lockout after 10 failures for 15 min.
const COUNTER = `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n`;
// The failure counter keeps a 15-minute window; the 10th failure locks the account for 15 minutes.
const FAILURE = `local n=redis.call('INCR',KEYS[1]); redis.call('EXPIRE',KEYS[1],900); if n>=10 then redis.call('SET',KEYS[2],'1','EX',900) end; return n`;
const RATE_LIMITED = { code: 'RATE_LIMITED', message: 'Too many attempts. Wait a minute and try again.' } as const;
const tooMany = () => new HttpException(RATE_LIMITED, 429);
@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}
  private key(value: string) { return 'kpmpl:auth:' + createHash('sha256').update(value).digest('hex'); }
  /** General API budget: 300/min per session (brief §3). */
  async limitPerSession(sessionId: string): Promise<void> {
    const n = await this.redis.client.eval(COUNTER, 1, this.key('session:' + sessionId), 60) as number;
    if (n > 300) throw tooMany();
  }
  /** Login budget: 5/min per IP+username combination (brief §3). */
  async limitLogin(ip: string, username: string): Promise<void> {
    const n = await this.redis.client.eval(COUNTER, 1, this.key('login:' + ip + ':' + username.toLowerCase()), 60) as number;
    if (n > 5) throw tooMany();
  }
  // B-32: the failure lockout is scoped to IP+account, so an attacker cannot lock a victim
  // out of their account from a different IP. A legitimate user from their own IP is unaffected.
  async checkAccount(username: string, ip: string): Promise<void> {
    if (await this.redis.client.exists(this.key('lock:' + ip + ':' + username.toLowerCase()))) throw tooMany();
  }
  async failure(username: string, ip: string): Promise<void> {
    await this.redis.client.eval(FAILURE, 2, this.key('fail:' + ip + ':' + username.toLowerCase()), this.key('lock:' + ip + ':' + username.toLowerCase()));
  }
  async success(username: string, ip: string): Promise<void> {
    await this.redis.client.del(this.key('fail:' + ip + ':' + username.toLowerCase()), this.key('lock:' + ip + ':' + username.toLowerCase()));
  }
}
