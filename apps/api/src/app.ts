import 'reflect-metadata';
import { Body, Catch, Controller, Delete, Get, HttpException, Inject, Module, Param, Post, Req, Res, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express, { type Request, type Response, type NextFunction } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Ledger, Operation, ProviderEvent, Store } from '../../../packages/banking/contracts.js';
import { BankingService } from '../../../packages/banking/service.js';
import { Sessions, SESSION_COOKIE, readSessionCookie } from './sessions.js';
import { signProviderEvent, verifyProviderEvent, WebhookError } from './webhooks.js';

export interface ApiDependencies { store: Store; ledger: Ledger; banking: BankingService; sessions: Sessions; }
export interface ApiConfig {
  webhookSecret: string; trustedOrigins: string[]; cookieSecure?: boolean;
  staticDirectory?: string; health?: () => Promise<void>; rateLimit?: number;
}
type RawRequest = Request & { rawBody?: Buffer };
type Dependencies = ApiDependencies & { config: ApiConfig };
function fault(status: number, code: string, message: string): never { throw new HttpException({ error: { code, message } }, status); }
function fields(body: unknown, allowed: string[]): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) fault(400, 'INVALID_INPUT', 'Invalid request fields');
  return body as Record<string, unknown>;
}
function textField(body: Record<string, unknown>, key: string, max = 160): string {
  const value = body[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > max) fault(400, 'INVALID_INPUT', `Enter a valid ${key}`);
  return value;
}
function key(req: Request): string {
  const value = req.header('Idempotency-Key');
  if (!value || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) fault(400, 'IDEMPOTENCY_REQUIRED', 'A valid Idempotency-Key is required');
  return value;
}

@Catch()
class ApiErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (error instanceof HttpException) {
      const body = error.getResponse();
      if (typeof body === 'object' && body && 'error' in body && typeof body.error === 'object') { res.status(error.getStatus()).json(body); return; }
      res.status(error.getStatus()).json({ error: { code: 'REQUEST_REJECTED', message: error.message } }); return;
    }
    if (error instanceof WebhookError) { res.status(401).json({ error: { code: 'INVALID_WEBHOOK', message: error.message } }); return; }
    if (error instanceof Error && 'status' in error && 'code' in error && typeof error.status === 'number' && error.status >= 400 && error.status < 600) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } }); return;
    }
    // Never expose database URLs, headers, provider credentials, or stack traces to customers.
    res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'The sandbox could not confirm this action. Retry the same request to recover its status.' } });
  }
}

@Controller('api')
class BankingController {
  constructor(@Inject('dependencies') private readonly deps: Dependencies) {}
  private async customer(req: Request): Promise<string> {
    const session = await this.deps.sessions.resolve(readSessionCookie(req.headers.cookie));
    if (!session) fault(401, 'SESSION_REQUIRED', 'Open a sandbox session to continue');
    return session.customerId;
  }
  @Get('health') async health() {
    await this.deps.config.health?.();
    await this.deps.ledger.health();
    return { status: 'ok', environment: 'sandbox', realFunds: false };
  }
  @Post('sandbox/sessions') async start(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    fields(body, []);
    const current = await this.deps.sessions.resolve(readSessionCookie(req.headers.cookie));
    if (current) return this.deps.banking.dashboard(current.customerId);
    const customer = await this.deps.banking.createCustomer();
    const { token } = await this.deps.sessions.create(customer.id);
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, secure: !!this.deps.config.cookieSecure, sameSite: 'strict', path: '/', maxAge: 86400000 });
    return this.deps.banking.dashboard(customer.id);
  }
  @Delete('session') async end(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.deps.sessions.revoke(readSessionCookie(req.headers.cookie));
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: !!this.deps.config.cookieSecure, sameSite: 'strict', path: '/' });
    return { ok: true };
  }
  @Get('dashboard') async dashboard(@Req() req: Request) { return this.deps.banking.dashboard(await this.customer(req)); }
  @Post('sandbox/funding') async fund(@Req() req: Request, @Body() body: unknown) {
    const customerId = await this.customer(req);
    return this.deps.banking.fund(customerId, textField(fields(body, ['amount']), 'amount', 20), key(req));
  }
  @Post('quotes') async quote(@Req() req: Request, @Body() body: unknown) {
    return this.deps.banking.quote(await this.customer(req), textField(fields(body, ['amount']), 'amount', 20));
  }
  @Post('exchanges') async exchange(@Req() req: Request, @Body() body: unknown) {
    return this.deps.banking.exchange(await this.customer(req), textField(fields(body, ['quoteId']), 'quoteId'), key(req));
  }
  @Post('payouts') async payout(@Req() req: Request, @Body() body: unknown) {
    const customerId = await this.customer(req); const input = fields(body, ['amount','beneficiary']);
    return this.deps.banking.payout(customerId, textField(input, 'amount', 20), textField(input, 'beneficiary', 80), key(req));
  }
  @Get('reconciliation') async reconcile(@Req() req: Request) { return this.deps.banking.reconciliation(await this.customer(req)); }
  @Post('sandbox/payouts/:id/settle') async simulate(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const customerId = await this.customer(req); const input = fields(body, ['outcome']);
    const outcome = textField(input, 'outcome', 10);
    if (outcome !== 'succeeded' && outcome !== 'failed') fault(400, 'INVALID_OUTCOME', 'Choose succeeded or failed');
    const op = await this.deps.store.get<Operation>('operations', id);
    if (!op || op.customerId !== customerId || op.kind !== 'payout') fault(404, 'PAYOUT_NOT_FOUND', 'Payout not found');
    const event: ProviderEvent = { id: `sim-${op.id}-${outcome}`, operationId: op.id, customerId, outcome, amountMinor: op.amountMinor, currency: 'NGN', createdAt: op.createdAt };
    const raw = Buffer.from(JSON.stringify(event)); const timestamp = Math.floor(Date.now()/1000).toString();
    const signature = signProviderEvent(raw, timestamp, this.deps.config.webhookSecret);
    return this.deps.banking.settle(verifyProviderEvent(raw, timestamp, signature, this.deps.config.webhookSecret));
  }
  @Post('provider/webhook') async webhook(@Req() req: RawRequest) {
    if (!req.rawBody) fault(400, 'RAW_BODY_REQUIRED', 'A JSON event body is required');
    const event = verifyProviderEvent(req.rawBody, req.header('X-Evolve-Timestamp'), req.header('X-Evolve-Signature'), this.deps.config.webhookSecret);
    return this.deps.banking.settle(event);
  }
}

export async function createApp(deps: ApiDependencies, config: ApiConfig): Promise<NestExpressApplication> {
  if (config.webhookSecret.length < 32) throw new Error('A webhook secret of at least 32 characters is required');
  @Module({ controllers: [BankingController], providers: [{ provide: 'dependencies', useValue: { ...deps, config } }] })
  class RuntimeModule {}
  const app = await NestFactory.create<NestExpressApplication>(RuntimeModule, { logger: false, rawBody: true });
  app.useBodyParser('json', { limit: '16kb' });
  app.disable('x-powered-by');
  const visits = new Map<string, { until: number; count: number }>();
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    // Express routes are case-insensitive by default; guard the same route set.
    const apiPath = req.path.toLowerCase();
    if (apiPath.startsWith('/api/')) {
      const origin = req.headers.origin;
      if (origin && !config.trustedOrigins.includes(origin)) { res.status(403).json({ error: { code: 'ORIGIN_REJECTED', message: 'Origin is not allowed' } }); return; }
      if (['POST','PUT','PATCH'].includes(req.method) && !req.is('application/json')) { res.status(415).json({ error: { code: 'JSON_REQUIRED', message: 'Use application/json' } }); return; }
      const bucket = `${req.socket.remoteAddress ?? 'unknown'}:${apiPath === '/api/sandbox/sessions' ? 'sessions' : 'api'}`;
      const now = Date.now(); const visit = visits.get(bucket);
      const limit = config.rateLimit ?? (apiPath === '/api/sandbox/sessions' ? 20 : 180);
      const nextVisit = !visit || visit.until <= now ? { until: now+60000, count: 1 } : { ...visit, count: visit.count+1 };
      visits.set(bucket, nextVisit);
      if (visits.size > 5000) for (const [k,v] of visits) if (v.until <= now) visits.delete(k);
      if (nextVisit.count > limit) { res.setHeader('Retry-After', '60'); res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Please wait a minute before trying again' } }); return; }
    }
    next();
  });
  app.useGlobalFilters(new ApiErrors());
  const staticDirectory = config.staticDirectory;
  if (staticDirectory && existsSync(resolve(staticDirectory, 'index.html'))) {
    app.use(express.static(staticDirectory, { index: false, redirect: false }));
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method === 'GET' && !req.path.toLowerCase().startsWith('/api') && req.accepts('html')) res.sendFile(resolve(staticDirectory, 'index.html'));
      else next();
    });
  }
  await app.init();
  return app;
}
